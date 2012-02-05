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

For a standard, non-transparent HTTPS proxy the server intercepts a CONNECT statement (with node's upgrade support) and get's the desired host name. If the host name matches one of the <tt>sslCerts</tt>, the proxy server will tunnel the client with the local HTTPS server using that certificate. Otherwise, the proxy server will tunnel with the desired remote server.

Transparent HTTPS proxy gets a little bit tricky. When the client sends a TLS handshake (the first packet), the client can specify extensions which are allows to contain the server name field. This is referred to as Server Name Indication or SNI. There's a very simple TLS handshake parser (https://github.com/axiak/filternet/blob/master/lib/sniparse.js) that tries to get the server name from the TLS handshake packet. If successful, the proxy server uses the same rules as it does for the CONNECT promotion: look for a certificate matching the host name pattern and intercept if it matches. Note that not every HTTPS client supports SNI, notably absent from the list of support is any IE on Windows XP (see http://en.wikipedia.org/wiki/Server_Name_Indication for more information). 

## Author, License, etc

The module is licensed under BSD 3-clause and is authored by mike@axiak.net