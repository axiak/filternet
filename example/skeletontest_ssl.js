var proxy = require('../lib/proxy.js');


var sslCerts = {
    '*':            ['keys/example.com.key.free', 'keys/example.com.crt'],
    '*.google.com': ['keys/star.google.com.key.free', 'keys/star.google.com.crt'],
    'google.com':   ['keys/google.com.key.free', 'keys/google.com.crt']
};

var myProxy = proxy.createProxyServer({
                                        sslCerts: sslCerts,
                                        sslSockDir: '/tmp',
                                        port: 8008,
                                        transSslPort: 8009,
                                        via: 'my test proxy/1.1' // use false to turn off via
                                    });


// Whether or not to reject a client
myProxy.on('shouldReject', function (request, callback) {
    // if callback(true), we return a 407
    callback(false);
});


// Whether or not to enable custom intercepting at all.
myProxy.on('enabledCheck', function (callback) {
    callback(true);
});

// Whether or not we should intercept and buffer the proxy response
// The default is to buffer all HTML responses.
myProxy.on('shouldInterceptResponse', function (proxy_response, callback) {
    var isHtml = (proxy_response.headers['content-type'] &&
                  proxy_response.headers['content-type'].toLowerCase().indexOf("html") != -1);
    callback(isHtml);
});

// You can rewrite the request as it's being sent to the remote server.
// (just headers)
myProxy.on('interceptRequest', function (request_info, callback) {
   // request_info is the same as the arguments to http.request
   console.log(request_info['host'], request_info['path']);
   callback(request_info);
});


// You can change response headers
myProxy.on('interceptResponseHeaders', function (request_info, statusCode, headers, callback) {
    callback(statusCode, headers);
});

// You can alter any response body that you said you want to intercept in "shouldInterceptResponse"
// by default this is all HTML responses if 'enabledCheck' is true (default)
// The response object is the standard node http response object.
myProxy.on('interceptResponseContent', function (buffer, response_object, is_ssl, callback) {
    callback(buffer);
});

// Should implement some error else the program will fail on any socket error.
myProxy.on('error', function (error) {
   console.log(error.stack);
});