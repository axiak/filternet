var Buffer = require('buffer').Buffer;

// Given a buffer for a TLS handshake packet
// the function getSNI will look for
// a server_name extension field
// and return the server_name value if found.
// See RFC 3546 (tls) and RFC 4366 (server extension)
// for more details.

var getSNI = function (buffer) {
    if (buffer.readInt8(0) !== 22) {
        // not a TLS Handshake packet
        return null;
    }
    // Session ID Length (static position)
    var currentPos = 43;
    // Skip session IDs
    currentPos += 1 + buffer[currentPos];

    // skip Cipher Suites
    currentPos += 2 + buffer.readInt16BE(currentPos);

    // skip compression methods
    currentPos += 1 + buffer[currentPos];

    // We are now at extensions!
    currentPos += 2; // ignore extensions length
    while (currentPos < buffer.length) {
        if (buffer.readInt16BE(currentPos) === 0) {
            // we have found an SNI
            var sniLength = buffer.readInt16BE(currentPos + 2);
            currentPos += 4;
            if (buffer[currentPos] != 0) {
                // the RFC says this is a reserved host type, not DNS
                return null;
            }
            currentPos += 5;
            return buffer.toString('utf8', currentPos, currentPos + sniLength - 5);
        } else {
            currentPos += 4 + buffer.readInt16BE(currentPos + 2);
        }
    }
    return null;
};

module.exports.getSNI = getSNI;

var test = function () {
    // IE on windows
    //var example = '16030100680100006403014f2d7b03a370d2092b2f7338bdc4fa7a9f28b318b5ac27ad25fea7040e66711820191179fa8a0e05b9d6ec968600ddc4268e806276f5240c7368185ea5b7d2405c001600040005000a0009006400620003000600130012006301000005ff01000100';
    // Chrome on windows
    var example = '16030100b7010000b303014f2d7b3fb3847e21eb297c07f8a7c4621b5ebe664790961f9e9b2dd49d6c1ab6000048c00ac0140088008700390038c00fc00500840035c007c009c011c01300450044006600330032c00cc00ec002c0040096004100040005002fc008c01200160013c00dc003feff000a020100004100000015001300001063626b73312e676f6f676c652e636f6dff01000100000a00080006001700180019000b000201000023000033740000000500050100000000';
    console.log(getSNI(new Buffer(example, 'hex')));
};
