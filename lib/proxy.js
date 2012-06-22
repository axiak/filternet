var http = require('http')
  , url = require('url')
  , fs = require('fs')
  , https = require('https')
  , net = require('net')
  , path = require('path')
  , exec = require('child_process').exec
  , EventEmitter = require('events').EventEmitter
  , zlib = require('zlib')
  , sniparse = require('./sniparse');

require('bufferjs/concat');
require('bufferjs/add-chunk');
require('./regexp-escape');

var serverHostName = 'unknown';

exec("hostname", function (err, stdout, stderr) {
    serverHostName = stdout.trim();
});

var fixEncoding = function (headers) {
    encoding = headers['accept-encoding'] || '';
    if (!encoding) {
        return;
    }
    // We only support 'identity', 'gzip', or 'deflate'
    headers['accept-encoding'] = encoding.split(',')
        .filter(function (e) {
             return e === 'gzip' || e === 'deflate' || e === 'identity';
        })
        .join(',');
};

var fixHeaderCase = function (headers) {
    var result = {};
    for (var key in headers) {
        if (!headers.hasOwnProperty(key))
            continue;
        var newKey = key.split('-')
                         .map(function(token){ return token[0].toUpperCase()+token.slice(1); })
                         .join('-');
        result[newKey] = headers[key];
    }
    return result;
};



module.exports.createProxyServer = function (opts) {
    opts = opts || {};
    var mainPort = ~~(opts['port'] || 8128);
    var hostname = opts['hostname'];
    var enableCompression = opts['enableCompression'];
    if (enableCompression === undefined) {
        enableCompression = true;
    }
    var recompress = opts['recompress'];
    if (recompress === undefined) {
        recompress = enableCompression;
    }
    var via;

    if (opts['via'] === undefined) {
        via = 'filternet/0.0.2';
    } else if (opts['via'] !== false) {
        via = opts['via'];
    }

    var emitter = new EventEmitter();

    var emitOrRun = function (eventName, callback) {
        if (!emitter.listeners(eventName).length) {
            callback();
        } else {
            var args = Array.prototype.slice.call(arguments);
            args.shift();
            args.shift();
            args.unshift(eventName);
            emitter.emit.apply(emitter, args);
        }
    };

    var errorWrapper = function (wrapped) {
        return function (req, res) {
            try {
                return wrapped(req, res);
            } catch (error) {
                emitter.emit('error', error, 'request/response wrapper');
            }
        };
    };

    var serverDefinition = function (isSsl) { return errorWrapper(function (request, response) {
       var onEnabled = function (enabled) {
           var headers = request.headers;
           if (enabled) {
               if (enableCompression) {
                   fixEncoding(headers);
               } else {
                   headers['accept-encoding'] = 'identity';
               }
               delete headers['proxy-connection'];
           }
           var parsedUrl = url.parse(request.url);
           var parsedHost = url.parse('http://' + headers['host']);
           var clientIp = request.connection.remoteAddress || request.connection.socket.remoteAddress;
           if (headers['x-forwarded-for']) {
               headers['x-forwarded-for'] = headers['x-forwarded-for'] + ', ' + clientIp;
           } else {
               headers['x-forwarded-for'] = clientIp;
           }
           headers['forwarded-for'] = headers['x-forwarded-for'];

           if (via) {
               headers['via'] = request.httpVersion + ' ' + serverHostName;
               var localAddr = request.connection.address();
               if (localAddr !== null) {
                   headers['via'] += ':' + request.connection.address().port;
               }
               headers['via'] += ' (' + via + ')';
           }

           var requestInfo = {
               'host': parsedUrl.hostname || parsedHost.hostname,
               'port': ~~(parsedUrl.port || parsedHost.port || (isSsl ? 443 : 80)),
               'path': parsedUrl.pathname + (parsedUrl.search || '') + (parsedUrl.hash || ''),
               'method': request.method,
               'headers': headers
           };

           var runRequest = function (requestInfo) {
               requestInfo['headers'] = fixHeaderCase(requestInfo['headers']);
               var proxyRequest = (isSsl ? https: http).request(requestInfo, function (proxyResponse) {
                  var responseEncoding = proxyResponse.headers['content-encoding'];
                  var isHtml = (proxyResponse.headers['content-type'] &&
                                proxyResponse.headers['content-type'].toLowerCase().indexOf("html") != -1);

                  var writeResponse = function (shouldBuffer) {
                      var buffer = undefined, bufferLength = 0;
                      if (shouldBuffer) {
                          bufferLength = ~~(proxyResponse.headers['content-length'] || 0);
                          delete proxyResponse.headers['content-length'];
                          buffer = new Buffer(0);
                      }

                      proxyResponse.on('error', function (error) {
                          response.end();
                          emitter.emit('error', error, 'proxyResponse', requestInfo);
                      });

                      proxyResponse.on('data', function (chunk) {
                           if (shouldBuffer) {
                               buffer = Buffer.concat(buffer, chunk);
                           } else {
                               response.write(chunk);
                           }
                      });

                      proxyResponse.on('end', function () {
                           if (!shouldBuffer) {
                               response.end();
                               emitter.emit('completeUnfitered');
                               return;
                           }
                           var match = (proxyResponse.headers['content-type'] || '').match(/charset=([^;]+)/);
                           var charset = (match ? match[1] : null);

                           var writeResponse = function(outputBuffer) {
                               var encoding = recompress ? responseEncoding : undefined;
                               var writeOutput = function (error, b) {
                                   if (error) {
                                       emitter.emit('error', error, 'recompressing', requestInfo);
                                   }
                                   response.end(b);
                               };
                               switch (encoding) {
                               case 'gzip':
                                   zlib.gzip(outputBuffer, writeOutput);
                                   break;
                               case 'deflate':
                                   zlib.deflate(outputBuffer, writeOutput);
                                   break;
                               default:
                                   writeOutput(null, outputBuffer);
                               }
                           };

                           var setupIntercept = function (error, newBuffer) {
                               if (error) {
                                   emitter.emit('error', error, 'decompressing', requestInfo);
                               }
                               emitOrRun('interceptResponseContent', function () { writeResponse(newBuffer); },
                                         newBuffer, proxyResponse, isSsl, charset, writeResponse);
                           };
                           switch (responseEncoding) {
                           case 'gzip':
                               zlib.gunzip(buffer, setupIntercept);
                               break;
                           case 'deflate':
                               zlib.inflate(buffer, setupIntercept);
                               break;
                           default:
                               setupIntercept(null, buffer);
                           }
                      });

                      if (shouldBuffer) {
                          if (!recompress) {
                              delete proxyResponse.headers['content-encoding'];
                          }
                          emitOrRun('interceptResponseHeaders', function () {
                                        response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
                                    }, requestInfo, proxyResponse.statusCode, proxyResponse.headers, function (a, b) { response.writeHead(a, b); } );
                      } else {
                          response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
                      }
                  };
                  if (!enabled) {
                      writeResponse(false);
                  } else {
                      emitOrRun('shouldInterceptResponseContent', function () { writeResponse(isHtml); }, proxyResponse, writeResponse);
                  }
               });

               proxyRequest.on('error', function (error) {
                    if (error.code === 'ENOTFOUND') {
                        response.writeHead(504);
                        response.end("Error - host not found: " + requestInfo.host);
                    } else {
                        response.writeHead(503);
                        response.end();
                    }
                    emitter.emit('error', error, 'proxyRequest', requestInfo);
               });

               request.on('data', function (chunk) { proxyRequest.write(chunk, 'binary'); });
               request.on('end', function (chunk) { proxyRequest.end(); });
           };

           emitOrRun('interceptRequest', function () { runRequest(requestInfo); }, requestInfo, runRequest);

       };

       var onReject = function (reject) {
           if (reject) {
               response.writeHead(407, {});
               response.end();
           } else {
               emitOrRun('shouldEnableInterception', function () { onEnabled(true); }, onEnabled);
           }
       };

       if (isSsl) {
           onReject(false);
       } else {
           emitOrRun('shouldReject', function () { onReject(false); }, request, onReject);
       }
    });};

    /* Start http server */
    var httpServer = http.createServer(serverDefinition(false));
    httpServer.listen(mainPort, hostname);
    httpServer.on('clientError', function (error) { emitter.emit('clientError', error, 'proxyClient'); });
    httpServer.on('error', function (error) { emitter.emit('error', error, 'proxyServer'); });


    /* Parse the ssl options and create sslRouting, sslExact, and sslServers */
    var sslCerts = opts['sslCerts'] || {};
    var sslSockDir = opts['sslSockDir'] || '.';

    var sslRouting = [];
    var sslExact = {};
    var defaultSsl = false;
    var sslServers = {};

    for (key in sslCerts) {
        if (!sslCerts.hasOwnProperty(key))
            continue;
        if (sslCerts[key].length !== 2)
            throw new Error("Must specify two files per domain: key and certificate.");

        var socketPath = path.join(sslSockDir, path.basename(sslCerts[key][0]) + ".sock");
        sslServers[socketPath] = sslCerts[key];

        if (key === '*') {
            defaultSsl = socketPath;
        } else if (key.indexOf("*") === 0) {
            var regex = new RegExp("^[^.]+" + RegExp.escape(key.substr(1)) + "$");
            sslRouting.push([regex, socketPath]);
        } else {
            sslExact[key] = socketPath;
        }
    }

    /* Start https backend servers for each certficiate */
    var httpsServers = [];
    for (socketPath in sslServers) {
        if (!sslServers.hasOwnProperty(socketPath))
            continue;
        var sslOptions = {key:  fs.readFileSync(sslServers[socketPath][0]),
                          cert: fs.readFileSync(sslServers[socketPath][1])};

        var httpsServer = https.createServer(sslOptions, serverDefinition(true));
        httpsServer.listen(socketPath);
        httpsServer.on('clientError', function (error) { emitter.emit('clientError', error, 'httpsClient'); });
        httpsServer.on('error', function (error) { emitter.emit('error', error, 'httpsServer'); });
        httpsServers.push(httpsServer);
    }

    var sslProxy = function (isEnabled, requesturl, socket, initialData) {
        var parsedUrl = url.parse('https://' + requesturl);
        var hostName = parsedUrl.hostname.toLowerCase();

        var serverSocketPath = sslExact[hostName];
        if (isEnabled && !serverSocketPath) {
            for (var i = 0, l = sslRouting.length; i < l; i++) {
                if (hostName.search(sslRouting[i][0]) !== -1) {
                    serverSocketPath = sslRouting[i][1];
                    break;
                }
            }
            if (!serverSocketPath && defaultSsl !== false) {
                serverSocketPath = defaultSsl;
            }
        }

        var clientSocket;
        if (isEnabled && serverSocketPath) {
            clientSocket = net.createConnection(serverSocketPath);
        } else {
            clientSocket = net.createConnection(~~(parsedUrl.port || 443), hostName);
        }

        clientSocket.on('connect', function () {
            try {
                if (initialData !== undefined) {
                    clientSocket.write(initialData);
                } else {
                    socket.write('HTTP/1.0 200 Connection established\r\n\r\n');
                }
            } catch (error) {
                emitter.emit('error', error, 'httpsSocketConnect');
            }
        });

        clientSocket.on('data', function (data) {
            try {
                socket.write(data);
            } catch (error) {
                try {
                    clientSocket.end();
                } catch (error) {}
                emitter.emit('error', error, 'httpsSocketData');
            }
        });

        clientSocket.on('error', function (error) {
            socket.end(); 
            emitter.emit('error', error, 'httpsClientSocket');
        });

        clientSocket.on('end', function () { socket.end(); });

        socket.on('data', function (data) {
            try {
                clientSocket.write(data);
            } catch (error) {
                try {
                    socket.end();
                } catch (error) {}
                emitter.emit('error', error, 'httpsClientSocketData');
            }
        });

        socket.on('error', function (error) {
            clientSocket.end(); 
            emitter.emit('error', error, 'httpsSocket');
        });

        socket.on('end', function () { clientSocket.end(); });
    };

    /* This allows the browser to use HTTPS with CONNECT */
    httpServer.on('upgrade', function (request, socket, head) {
        var onEnabled = function (isEnabled) {
            return sslProxy(isEnabled, request.url, socket);
        };
        var onReject = function (reject) {
            if (reject) {
                socket.end();
            } else {
                emitOrRun('shouldEnableInterception', function () { onEnabled(true); }, onEnabled);
            }
        };
        emitOrRun('shouldReject', function () { onReject(false); }, request, onReject);
    });

    /* Transparent ssl proxy */
    if (opts['transSslPort']) {
        var transSslServer = net.createServer(function (socket) {
           var firstPacket = true;
           socket.on('data', function (data) {
               socket.removeAllListeners('data');
               var hostName = sniparse.getSNI(data);
               var onEnabled = function (isEnabled) {
                   return sslProxy(isEnabled, hostName, socket, data);
               };
               emitOrRun('enabledCheck', function () { onEnabled(true); }, onEnabled);
           });
        });
        transSslServer.listen(opts['transSslPort'], hostname);
        transSslServer.on('error', function (e) {
            if (e.code == 'EADDRINUSE') {
                console.log('Address in use, retrying...');
                setTimeout(function () {
                  server.close();
                  server.listen(opts['transSslPort'], hostname);
                }, 1000);
            } else {
                emitter.emit('error', e, 'transSslError');
            }
        });

    }
    return emitter;
};
