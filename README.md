[![build status](https://secure.travis-ci.org/axiak/filternet.png)](http://travis-ci.org/axiak/filternet)
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

myProxy.on("interceptResponseContent", function (buffer, responseObject, isSsl, charset, callback) {
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

myProxy.on("interceptResponseContent", function (buffer, responseObject, isSsl, charset, callback) {
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
- via - Either the name to give to the VIA header, or false to squelch the VIA header. Default: filternet/0.0.2
- enableCompression - Whether or not to enable HTTP compression. If false, the accept-encoding header will tell the remote server to not compress. Default: true
- recompress - If the response from the server was compressed, this will determine if the proxy will recompress the decompressed content for the client. Default: equal to <tt>enableCompression</tt>
- sslCerts - The mapping of host description to ssl keys/certificates (see SSL Certificates). Default: {}
- sslSockDir - If there are sslCerts, this will determine where to put the sockets for the https servers to listen on. Default: '.'
- transSslPort - If provided, this will be the port to enable the transparent HTTPS proxy. Default: undefined

## Events

### Event: shouldReject <tt>function (request, callback){}</tt>

This gets called first on every http request or intercepted https request.
If you call <tt>callback(true)</tt>, the proxy server will return a 407 response and complete.


### Event: shouldEnableInterception <tt>function (callback){}</tt>

This is used to disable intercepting. If you run callback(false), the proxy server will run as a normal proxy server would. callback(true) will enable your other listeners.

The default behavior is callback(true)

### Event: interceptRequest <tt>function (requestOptions, callback)</tt>

requestOptions is a map of data to be sent to http.request. callback expects requestOptions to continue the request.

The default behavior is callback(requestOptions);

### Event: interceptResponseHeaders: <tt>function (requestInfo, responseStatusCode, responseHeaders, callback)</tt>

callback expects (responseStatusCode, responseHeaders). You can use this method if you want to manipulate the response headers before they get sent.

The default behavior is callback(responseStatusCode, responseHeaders);

### Event: shouldInterceptResponseContent <tt>function (response, callback)</tt>

Given the response from the remote server, this listener enabled you to decide if the interception should happen or not. Run callback(true) if you intend on intercepting the response content.

The default behavior is callback(isHtml), where isHtml is true if the content-type is something like text/html.

(The use of the method prevents the proxy server from having to buffer images, etc.)

### Event: interceptResponseContent <tt>function (buffer, remoteResponse, isSsl, charset, callback)</tt>

callback expects the content buffer or string to send to the client.

isSsl is true if this interception was performed on an https request.

charset is a convenience string which is either the charset from the Content-Type header, or null if none was defined.

Generally, if charset is not null it's safer to run buffer.toString('utf8') to get a string. Otherwise you're probably dealing with binary data.

The default behavior is callback(buffer);

### Event: error <tt>function (error, [errorSourceString], [requestInfo])</tt>

Called on any error that is not a clientError. If available an error source string and the requestInfo object will be provided.

If not defined errors actually break the proxy server.

### Event: clientError <tt>function (error)</tt>

Called on any clientError

If not defined errors actually break the proxy server.

## Compression

HTTP defines compression with the Accept-Encoding header. Intercepting and analysing responses are somewhat incompatible with compression, so this library tries to get around this limitation in two ways:

1. Disable compression entirely
2. On-the-fly decompression and recompression

If <tt>enableCompression</tt> is false, then the client's Accept-Encoding header will be rewritten to 'identity' if interception is enabled (see the enabledCheck event). Note that you can't turn off compression for _just_ HTML, as we don't know until the response from the remote server whether or not the document is HTML.

If <tt>enabledCompression</tt> is true, then the Accept-Encoding is mangled to ensure it contains nothing more than 'gzip','deflate', or 'identity'. Then the remote response headers will indicate if the response is compressed. The response is then decompressed before they are sent to any listeners.

If <tt>recompress</tt> is enabled, then the potentially manipulated response content is then compressed again, using whatever method (gzip or deflate) was used to decompress from the server. Note that the <tt>recompress</tt> flag determines if the Content-Encoding header is mangled before it's sent to the client.

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

## Motivation

I created and used this module to alter my now wife's Google doodle to eventually lead to a proposal. She said yes, so this project was a success.

## Bugs

I'm sure there are some at the moment. If you encounter any, or if you have any improvements, feel free to file an issue or send a merge request my way.

## Author, License, etc

The module is licensed under BSD 3-clause and is authored by mike@axiak.net
