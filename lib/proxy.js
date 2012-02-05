var http = require('http')
  , url = require('url')
  , fs = require('fs')
  , https = require('https')
  , net = require('net')
  , path = require('path')
  , exec = require('child_process').exec
  , EventEmitter = require('events').EventEmitter
  , sniparse = require('./sniparse');

require('bufferjs/add-chunk');

if (!RegExp.escape) {
    RegExp.escape = function(text) {
        return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    };
}

var serverHostName = 'unknown';

exec("hostname", function (err, stdout, stderr) {
    serverHostName = stdout.trim();
});

module.exports.createProxyServer = function (opts) {
    opts = opts || {};
    var main_port = ~~(opts['port'] || process.env.PORT || 8128);
    var hostname = opts['hostname'];
    var via;

    if (opts['via'] === undefined) {
        via = 'nodeproxy/0.0.1';
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
                emitter.emit('error', error);
            }
        };
    };

    var serverDefinition = function (is_ssl) { return errorWrapper(function (request, response) {
       var onEnabled = function (enabled) {
           if (enabled) {
               request.headers['accept-encoding'] = 'identity';
               delete request.headers['proxy-connection'];
           }
           var parsed_url = url.parse(request.url);
           var parsed_host = url.parse('http://' + request.headers['host']);
           var headers = request.headers;
           var client_ip = request.connection.remoteAddress || request.connection.socket.remoteAddress;
           if (headers['x-forwarded-for']) {
               headers['x-forwarded-for'] = headers['x-forwarded-for'] + ', ' + client_ip;
           } else {
               headers['x-forwarded-for'] = client_ip;
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

           var request_info = {
               'host': parsed_url.hostname || parsed_host.hostname,
               'port': ~~(parsed_url.port || parsed_host.port || (is_ssl ? 443 : 80)),
               'path': parsed_url.pathname + (parsed_url.search || '') + (parsed_url.hash || ''),
               'method': request.method,
               'headers': headers
           };

           var runRequest = function (request_info) {
               var proxy_request = (is_ssl ? https: http).request(request_info, function (proxy_response) {
                  var isHtml = (proxy_response.headers['content-type'] &&
                                proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1);
                  var writeResponse = function (shouldBuffer) {
                      var buffer = new Buffer();
                      if (shouldBuffer) {
                          delete proxy_response.headers['content-length'];
                      }

                      proxy_response.on('error', function (error) {
                          emitter.emit('error', error);
                      });

                      proxy_response.on('data', function (chunk) {
                           if (shouldBuffer) {
                               buffer.addChunk(chunk);
                           } else {
                               response.write(chunk, 'binary');
                           }
                      });

                      proxy_response.on('end', function () {
                           if (!shouldBuffer) {
                               response.end();
                               emitter.emit('completeUnfitered');
                               return;
                           }
                           var match = (proxy_response.headers['content-type'] || '').match(/charset=([^;]+)/);
                           var charset = (match ? match[1] : null);
                           emitOrRun('interceptResponseContent', function () { response.end(buffer); },
                                     buffer, proxy_response, is_ssl, charset, function (b) { response.end(b); });
                      });

                      if (shouldBuffer) {
                          emitOrRun('interceptResponseHeaders', function () {
                                        response.writeHead(proxy_response.statusCode, proxy_response.headers);
                                    }, request_info, proxy_response.statusCode, proxy_response.headers, function (a, b) { response.writeHead(a, b); } );
                      } else {
                          response.writeHead(proxy_response.statusCode, proxy_response.headers);
                      }
                  };
                  if (!enabled) {
                      writeResponse(false);
                  } else {
                      emitOrRun('shouldInterceptResponse', function () { writeResponse(isHtml); }, proxy_response, writeResponse);
                  }
               });

               proxy_request.on('error', function (error) { emitter.emit('error', error); });

               request.on('data', function (chunk) { proxy_request.write(chunk, 'binary'); });
               request.on('end', function (chunk) { proxy_request.end(); });
           };

           emitOrRun('interceptRequest', function () { runRequest(request_info); }, request_info, runRequest);

       };

       var onReject = function (reject) {
           if (reject) {
               response.writeHead(407, {});
               response.end();
           } else {
               emitOrRun('enabledCheck', function () { onEnabled(true); }, onEnabled);
           }
       };

       if (is_ssl) {
           onReject(false);
       } else {
           emitOrRun('shouldReject', function () { onReject(false); }, request, onReject);
       }
    });};

    /* Start http server */
    var httpServer = http.createServer(serverDefinition(false));
    httpServer.listen(main_port, hostname);
    httpServer.on('clientError', function (error) { emitter.emit('clientError', error); });
    httpServer.on('error', function (error) { emitter.emit('error', error); });


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
        httpsServer.on('clientError', function (error) { emitter.emit('clientError', error); });
        httpsServer.on('error', function (error) { emitter.emit('error', error); });
        httpsServers.push(httpsServer);
    }

    var sslProxy = function (isEnabled, requesturl, socket, initialData) {
        var parsed_url = url.parse('https://' + requesturl);
        var host_name = parsed_url.hostname.toLowerCase();

        var serverSocketPath = sslExact[host_name];
        if (isEnabled && !serverSocketPath) {
            for (var i = 0, l = sslRouting.length; i < l; i++) {
                if (host_name.search(sslRouting[i][0]) !== -1) {
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
            clientSocket = net.createConnection(~~(parsed_url.port || 443), host_name);
        }

        clientSocket.on('connect', function () {
            try {
                if (initialData !== undefined) {
                    clientSocket.write(initialData);
                } else {
                    socket.write('HTTP/1.0 200 Connection established\r\n\r\n');
                }
            } catch (error) {
                emitter.emit('error', error);
            }
        });

        clientSocket.on('data', function (data) {
            try {
                socket.write(data);
            } catch (error) {
                emitter.emit('error', error);
            }
        });

        clientSocket.on('end', function () { socket.end(); });

        socket.on('data', function (data) {
            try {
                clientSocket.write(data);
            } catch (error) {
                emitter.emit('error', error);
            }
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
                emitOrRun('enabledCheck', function () { onEnabled(true); }, onEnabled);
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
                emitter.emit('error', e);
            }
        });

    }
    return emitter;
};