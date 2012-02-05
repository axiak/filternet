# filternet - A simple way to filter http in node.js

filternet implements a feature-packed proxy server that allows the coder to intercept and manipulate requests and responses in a consistent manner. filternet is designed to behave consistently with:

- standard HTTP proxy
- transparent HTTP proxy
- standard HTTPS proxy (with specified certificates)
- transparent HTTPS proxy (with specified certificates and SNI)
- compression for both directions (deflate and gzip, no sdch)

## Quick Examples

Simplest example, everything is blinking!

```js
var filternet = require('filternet');

var myProxy = filternet.createProxyServer();

myProxy.on("interceptResponseContent", function (buffer, response_object, is_ssl, charset, callback) {
  var content = buffer.toString('utf8');
  var css = "<"+"link rel='stylesheet' href='http://axiak.github.com/filternet/blink.css'>";
  callback(content.replace(/<\/head>/i, css + "</head>"));
});
```
Run this and it will automatically listen at port 8128.


Simple https example:

```js
var filternet = require('filternet');

var sslCerts = {
   '*.github.com': ['stargithub.key', 'stargithub.crt']
};

var myProxy = filternet.createProxyServer({
   sslCerts: sslCerts,
   transSslPort: 8129 // enable transparent ssl proxy
});

myProxy.on("interceptResponseContent", function (buffer, response_object, is_ssl, charset, callback) {
   console.log(buffer.toString('utf8'));
   callback(buffer);
});
```
This example will work as both a regular HTTPS proxy (via CONNECT) as well as a transparent HTTPS proxy (via SNI). The proxy will log bodies for _all_ HTTP responses, and _only_ HTTPS responses that fit '*.github.com' (note that the asterisk only works one level deep, see the SSL Certificates section).

See https://github.com/axiak/filternet/blob/master/example/skeletontest.js for a simple showing of available hooks,
and https://github.com/axiak/filternet/blob/master/example/skeletontest_ssl.js for the same file with SSL intercept support.

## Options

The main function available is <tt>createProxyServer(opts)</tt> where the options available are:

- port - The port to listen on. Default: 8128
- hostname - The hostname to listen on. Default: server will accept any
- via - Either the name to give to the VIA header, or false to squelch the VIA header. Default: nodeproxy/0.0.1
- enableCompression - Whether or not to enable HTTP compression. If false, the accept-encoding header will tell the remote server to not compress. Default: true
- recompress - If the response from the server was compressed, this will determine if the proxy will recompress the decompressed content for the client. Default: equal to <tt>enableCompression</tt>
- sslCerts - The mapping of host description to ssl keys/certificates (see SSL Certificates). Default: {}
- sslSockDir - If there are sslCerts, this will determine where to put the sockets for the https servers to listen on. Default: '.'
- transSslPort - If provided, this will be the port to enable the transparent HTTPS proxy. Default: undefined

## Events

### Event: shouldReject <tt>function (request, callback){}</tt>

This gets called first on every intercepted https or http request.
If you call <tt>callback(true)</tt>, the proxy server will return a 407 response and complete.


### Event: enabledCheck <tt>function (callback){}</tt>

This is used to disable intercepting. If you run callback(false), the proxy server will run as a normal proxy server would. callback(true) will enable your other listeners.

The default behavior is callback(true)

### Event: interceptRequest <tt>function (request_options, callback)</tt>

request_options is a map of data to be sent to http.request. callback expects request_options to continue the request.

The default behavior is callback(request_options);

### Event: interceptResponseHeaders: <tt>function (request_info, response_status_code, response_headers, callback)</tt>

callback expects (response_status_code, response_headers). You can use this method if you want to manipulate the response headers before they get sent.

The default behavior is callback(response_status_code, response_headers);

### Event: shouldInterceptResponse <tt>function (response, callback)</tt>

Given the response from the remote server, this listener enabled you to decide if the interception should happen or not. Run callback(true) if you intend on intercepting the response content.

The default behavior is callback(isHtml), where isHtml is true if the content-type is something like text/html.

(The use of the method prevents the proxy server from having to buffer images, etc.)

### Event: interceptResponseContent <tt>function (buffer, proxy_response, is_ssl, charset, callback)</tt>

callback expects the content buffer or string to send to the client.

is_ssl is true if this interception was performed on an https request.

charset is a convenience string which is either the charset from the Content-Type header, or null if none was defined. 

Generally, if charset is not null it's safer to run buffer.toString('utf8') to get a string. Otherwise you're probably dealing with binary data.

The default behavior is callback(buffer);

### Event: error <tt>function (error)</tt>

Called on any error that is not a clientError

If not defined errors actually break the proxy server.

### Event: clientError <tt>function (error)</tt>

Called on any clientError

If not defined errors actually break the proxy server.

## HTTPS

### SSL Certificates

This module doesn't break SSL, and as such can't be used maliciously in conjunction with https.
By default, the proxy server will serve https documents transparently without eavesdropping or calling the
provided hooks to manipulate requests/responses. To alter this behavior, you need to specify the sslCerts
mapping:

```js
filternet.createProxyServer({sslCerts:
   { hostDescription: [keyFileName, certificateFileName]}
   });
```

The keyFileName and the certificateFileName are the paths to the SSL key file and certificate file. The hostDescription is one of three things:

- The complete hostname (e.g. 'www.example.com')
- A wild-card host (e.g. '*.example.com')
- The default host: '*'

It's important to note that <tt>'*.example.com'</tt> will match neither <tt>'example.com'</tt> nor <tt>'b.a.example.com'</tt>.

To create your own certificate authority and sign your own certificates for anything, I found Zach Miller's HOW-TO easy to follow: http://pages.cs.wisc.edu/~zmiller/ca-howto/

### How it works

For each distinct key file provided, the proxy server will launch a separate node HTTPS server bound to a socket file named based on the key file. (The directory is determined by the <tt>sslSockDir</tt> option.)

#### Standard HTTPS proxy

For a standard, non-transparent HTTPS proxy the server intercepts a CONNECT statement (with node's upgrade support) and get's the desired host name. If the host name matches one of the <tt>sslCerts</tt>, the proxy server will tunnel the client with the local HTTPS server using that certificate. Otherwise, the proxy server will tunnel with the desired remote server.

#### Transparent HTTPS proxy (SNI)

Transparent HTTPS proxy gets a little bit tricky. When the client sends a TLS handshake (the first packet), the client can specify extensions which are allows to contain the server name field. This is referred to as Server Name Indication or SNI. There's a very simple TLS handshake parser (https://github.com/axiak/filternet/blob/master/lib/sniparse.js) that tries to get the server name from the TLS handshake packet. If successful, the proxy server uses the same rules as it does for the CONNECT promotion: look for a certificate matching the host name pattern and intercept if it matches. 

Note that not every HTTPS client supports SNI: notably absent from the list of support is any IE on Windows XP (see http://en.wikipedia.org/wiki/Server_Name_Indication for more information). 

## Bugs

I'm sure there are some at the moment. If you encounter any, or if you have any improvements, feel free to file an issue or send a merge request my way.

## Author, License, etc

The module is licensed under BSD 3-clause and is authored by mike@axiak.net