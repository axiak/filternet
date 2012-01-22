var http = require('http');

var ADDITIONAL_CODE = "<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
                      "<script type='text/javascript'>$.noConflict();</script>" +
                      "<script type='text/javascript' src='http://cdnjs.cloudflare.com/ajax/libs/require.js/1.0.1/require.min.js'></script>" +
                      "<script type='text/javascript' src='http://axiak.github.com/injectfun/index.js'></script>";

var PORT = process.env.PORT || 8000;

console.log("Proxy listening on port " + PORT);

function fixHeaders(oldHeaders) {
  // node does something STUPID in that incoming headers will be all lowercased
  // but outgoing headers will not have their case affected so I have to fix
  // them here.
  // Return a new hash of HTTP headers such that each header name (key) in this
  // hash has the proper case. This will not work for the "TE" header, see
  // http://en.wikipedia.org/wiki/List_of_HTTP_header_fields
  var result = {};
  for (var header in oldHeaders) {
    if (oldHeaders.hasOwnProperty(header)) {(function(){
      // this is jslint's idea of "code style" ^ ^ ^
      // (personally, I think this entire function is full of fail. thanks,
      // node. thanks, jslint.)
      header = header.split('-')
                     .map(function(header){ return header[0].toUpperCase()+header.slice(1); })
                     .join('-');
      result[header] = oldHeaders[header.toLowerCase()];
    }());}
  }
  return result;
}

http.createServer(function(request, response) {
//  request.headers['accept-encoding'] = 'identity';
  delete request.headers['accept-encoding'];
  delete request.headers['proxy-connection'];

  var proxy = http.createClient(80, request.headers['host']);

  var proxy_request = proxy.request(request.method, request.url, fixHeaders(request.headers));

  proxy_request.addListener('response', function (proxy_response) {
    var isHtml = (proxy_response.headers['content-type'] &&
                  proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1),
        buffer = "";

    proxy_response.addListener('error', function (error) {
        console.log(error);
        console.log(error.stack);
    });

    proxy_response.addListener('data', function(chunk) {
      if (isHtml) {
          buffer += chunk.toString("utf-8");
      } else {
          response.write(chunk, 'binary');
      }
    });

    proxy_response.addListener('end', function() {
      if (isHtml) {
          delete proxy_response.headers['content-length'];
          var originalLength = buffer.length;
          buffer = buffer.replace(/<\/body>/i, ADDITIONAL_CODE + "</body>");
          if (buffer.length == originalLength && buffer.search(/<html>/i) !== -1) {
              buffer += ADDITIONAL_CODE;
          }
          response.end(buffer);
      } else {
          response.end();
      }
    });
    response.writeHead(proxy_response.statusCode, proxy_response.headers);
  });
  request.addListener('data', function(chunk) {
    proxy_request.write(chunk, 'binary');
  });
  request.addListener('end', function() {
    proxy_request.end();
  });
}).listen(process.env.PORT || 8000);