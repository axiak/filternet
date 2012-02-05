# filternet - A simple way to filter http in node.js

filternet implements a feature-packed proxy server that allows the coder to intercept and manipulate requests and responses in a consistent manner. filternet will work consistently with:

- standard HTTP proxy
- transparent HTTP proxy
- standard HTTPS proxy (with specified certificates)
- transparent HTTPS proxy (with specified certificates and SNI*)
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