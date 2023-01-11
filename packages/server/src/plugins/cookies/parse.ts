import { Cookie } from './types';

export interface ParseOptions {
    decode?: boolean;
}

const decode = decodeURIComponent;
const pairSplitRegExp = /; */;

// Try decoding a string using a decoding function.
function tryDecode(
    str: string,
    decode: ((encodedURIComponent: string) => string) | boolean
): string {
    try {
        return typeof decode === 'boolean' ? decodeURIComponent(str) : decode(str);
    } catch (e) {
        return str;
    }
}

/**
 * Parse a cookie header.
 *
 * Parse the given cookie header string into an object
 * The object has the various cookies as keys(names) => values
 */
export function parse(str: string, options: ParseOptions = {}): Cookie[] {
    if (typeof str !== 'string') {
        throw new TypeError('argument str must be a string');
    }

    const obj = [];
    const opt = options || {};
    const pairs = str.split(pairSplitRegExp);
    const dec = opt.decode || decode;

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let eqIdx = pair.indexOf('=');

        // skip things that don't look like key=value
        if (eqIdx < 0) {
            continue;
        }

        const key = pair.substr(0, eqIdx).trim();
        let val = pair.substr(++eqIdx, pair.length).trim();

        // quoted values
        if (val[0] === '"') {
            val = val.slice(1, -1);
        }

        // only assign once
        if (obj[key] == null) {
            obj.push({
                name: key,
                value: tryDecode(val, dec),
            });
        }
    }

    return obj;
}