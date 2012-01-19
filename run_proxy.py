#!/usr/bin/python
from twisted.web import proxy, http
from twisted.internet import reactor
from twisted.python import log
import re
import sys
log.startLogging(sys.stdout)

head_re = re.compile(r'</head>', re.I)
body_re = re.compile(r'</body>', re.I)

class CustomProxyClient(proxy.ProxyClient):
    def connectionMade(self):
        self.res_buffer = []
        self.content_type = None
        self.headers.pop('accept-encoding', None)
        return proxy.ProxyClient.connectionMade(self)

    def handleHeader(self, key, value):
        if key.lower() == 'content-type':
            self.content_type = value
        return proxy.ProxyClient.handleHeader(self, key, value)

    def isHtml(self):
        return self.content_type and \
            self.content_type.lower().split(';')[0] in (
            'text/html',
            'application/xhtml+xml',
            )

    def handleResponsePart(self, buffer):
        if self.isHtml():
            self.res_buffer.append(buffer)
        else:
            return proxy.ProxyClient.handleResponsePart(self, buffer)

    def handleResponseEnd(self):
        if not self.isHtml():
            return proxy.ProxyClient.handleResponseEnd(self)
        result = self.transform_content(''.join(self.res_buffer))
        try:
            self.father.write(result)
        except:
            print "Error length: " + str(len(result))
            print self.father.uri
            print '=' * 30
        proxy.ProxyClient.handleResponseEnd(self)

    def transform_content(self, result):
        inject_body = '''
<script type='text/javascript' src='http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js'></script>
<script type="text/javascript">$.noConflict();</script>
<script type="text/javascript" src="http://cdnjs.cloudflare.com/ajax/libs/require.js/1.0.1/require.min.js"></script>
<script type="text/javascript" src="http://cdnjs.cloudflare.com/ajax/libs/require.js/1.0.1/require.min.js"></script>
'''
        return body_re.sub(inject_body + '</body>', result)

class CustomProxyClientFactory(proxy.ProxyClientFactory):
    protocol = CustomProxyClient

class CustomProxyRequest(proxy.ProxyRequest):
    protocols = {'http': CustomProxyClientFactory}

class CustomProxy(proxy.Proxy):
    requestFactory = CustomProxyRequest

class ProxyFactory(http.HTTPFactory):
    protocol = CustomProxy

if __name__ == '__main__':
    reactor.listenTCP(8000, ProxyFactory())
    reactor.run()


