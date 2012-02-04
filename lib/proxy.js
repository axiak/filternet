var http = require('http')
  , url = require('url')
  , fs = require('fs')
  , https = require('https')
  , net = require('net')
  , EventEmitter = require('events').EventEmitter;

module.exports.createProxyServer = function (opts) {
    opts = opts || {};
    var main_port = ~~(opts['port'] || process.env.PORT || 8128);
    var hostname = opts['hostname'];

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

    var serverDefinition = function (is_ssl) { return function (request, response) {
       var onEnabled = function (enabled) {
           if (enabled) {
               request.headers['accept-encoding'] = 'identity';
               delete request.headers['proxy-connection'];
           }
           var parsed_url = url.parse(request.url);
           var parsed_host = url.parse('http://' + request.headers['host']);
           var request_info = {
               'host': parsed_url.hostname || parsed_host.hostname,
               'port': ~~(parsed_url.port || parsed_host.port || (is_ssl ? 443 : 80)),
               'path': parsed_url.pathname + (parsed_url.search || '') + (parsed_url.hash || ''),
               'method': request.method,
               'headers': request.headers
           };

           var runRequest = function (request_info) {
               var proxy_request = (is_ssl ? https: http).request(request_info, function (proxy_response) {
                  var isHtml = (proxy_response.headers['content-type'] &&
                                proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1);
                  var writeResponse = function (shouldBuffer) {
                      var buffer = "";
                      if (shouldBuffer) {
                          delete proxy_response.headers['content-length'];
                      }

                      proxy_response.on('error', function (error) {
                          emitter.emit('error', error);
                      });

                      proxy_response.on('data', function (chunk) {
                           if (shouldBuffer) {
                               buffer += chunk.toString("utf-8"); // todo - encoding?
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
                           emitOrRun('interceptResponseContent', function () { response.end(buffer); },
                                     buffer, proxy_response, function (b) { response.end(b); });
                      });

                      if (shouldBuffer) {
                          emitOrRun('interceptResponseHeaders', function () {
                                        response.writeHead(proxy_response.statusCode, proxy_response.headers);
                                    }, proxy_response.statusCode, proxy_response.headers, function (a, b) { response.writeHead(a, b); } );
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
       emitOrRun('enabledCheck', function () { onEnabled(true); }, onEnabled);

    };};

    var httpServer = http.createServer(serverDefinition(false));
    httpServer.listen(main_port, hostname);

    return emitter;
};