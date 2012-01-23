var http = require('http')
  , url = require('url')
  , fs = require('fs')
  , https = require('https')
  , net = require('net');

var ADDITIONAL_CODE = {
    80: "<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>$.noConflict();</script>" +
        "<script type='text/javascript' src='http://cdnjs.cloudflare.com/ajax/libs/require.js/1.0.1/require.min.js'></script>" +
        "<script type='text/javascript' src='http://axiak.github.com/injectfun/index.js'></script>",

    443: "<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>$.noConflict();</script>" +
        "<script type='text/javascript' src='http://cdnjs.cloudflare.com/ajax/libs/require.js/1.0.1/require.min.js'></script>" +
        "<script type='text/javascript' src='http://axiak.github.com/injectfun/index.js'></script>"
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
  if (oldHeaders['x-forwarded-for']) {
    oldHeaders['x-forwarded-for'] = result['x-forwarded-for'] + ',' + (request.connection.remoteAddress || request.connection.socket.remoteAddress);
  } else {
    oldHeaders['x-forwarded-for'] = request.connection.remoteAddress || request.connection.socket.remoteAddress;
  }

  for (var header in oldHeaders) {
    if (oldHeaders.hasOwnProperty(header)) {(function(){
      header = header.split('-')
                     .map(function(header){ return header[0].toUpperCase()+header.slice(1); })
                     .join('-');
      result[header] = oldHeaders[header.toLowerCase()];
    }());}
  }
  delete result['Connection'];
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


var serverDefinition = function (http_mod, default_port, is_ssl) { return catch_errors(function(request, response) {
  request.headers['accept-encoding'] = 'identity';
  delete request.headers['accept-encoding'];
  delete request.headers['proxy-connection'];

  var parsed_url = url.parse(request.url);

  var request_info = {
    'host': parsed_url.hostname || url.parse('http://' + request.headers['host']).hostname
  , 'port': ~~(parsed_url.port || default_port)
  , 'path': parsed_url.pathname + (parsed_url.search || '') + (parsed_url.hash || '')
  , 'method': request.method
  , 'headers': fixHeaders(request, request.headers)
  };
  debug_view(request_info);

  var proxy_request = http_mod.request(request_info, function (proxy_response) {
    var isHtml = (proxy_response.headers['content-type'] &&
                  proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1),
        buffer = "";

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
          delete proxy_response.headers['content-length'];
          var originalLength = buffer.length;
          buffer = buffer.replace(/<\/body>/i, ADDITIONAL_CODE[default_port] + "</body>");
          if (buffer.length == originalLength && buffer.search(/<html>/i) !== -1) {
              buffer += ADDITIONAL_CODE[default_port];
          }
          response.end(buffer);
      } else {
          response.end();
      }
    });

    proxy_response.on('error', unrecoverable_error(request, response));

    response.writeHead(proxy_response.statusCode, proxy_response.headers);
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
     var parsed_url = url.parse('https://' + request.url);
     /*
     var clientSocket = net.createConnection(~~(parsed_url.port || 443),
                                             parsed_url.hostname);
     */
     var clientSocket = net.createConnection(PORT + 1,
                                             'localhost');
     clientSocket.on('connect', function () {
         socket.write("200 OK\r\n\r\n");
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
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};

var httpsServer = https.createServer(sslOptions, serverDefinition(https, 443, true));
httpsServer.listen(PORT + 1);
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
console.log("Proxy listening on port " + PORT + " and port " + (PORT + 1));
