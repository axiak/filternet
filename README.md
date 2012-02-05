# filternet - A simple way to filter http in node.js

filternet implements a feature-packed proxy server that allows the coder to intercept and manipulate requests and responses in a consistent manner. filternet will work consistently with:

- standard HTTP proxy
- transparent HTTP proxy
- standard HTTPS proxy (with specified certificates)
- transparent HTTPS proxy (with specified certificates and SNI*)
- compression for both directions (deflate and gzip, no sdch)

## Examples

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
