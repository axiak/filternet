#!/bin/bash
HOST="$1"

openssl req -newkey rsa:1024 -keyout $HOST.key -nodes -config openssl.cnf -out $HOST.req
openssl ca -config openssl.cnf -out $HOST.crt -infiles $HOST.req
openssl rsa -in $HOST.key -out $HOST.key.free
rm -fv $HOST.key $HOST.req
mv $HOST.key.free $HOST.key
