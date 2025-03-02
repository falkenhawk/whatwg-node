const busboy = require('busboy');
const { resolve } = require('path');
const streams = require("stream");

module.exports = function getFormDataMethod(File, limits) {

  return function formData() {
    if (this.body == null) {
      return null;
    }
    const contentType = this.headers.get('Content-Type');
    const nodeReadable = this.body.on ? this.body : streams.Readable.from(this.body);
    const bb = busboy({
      headers: {
        'content-type': contentType
      },
      limits,
      defParamCharset: 'utf-8'
    });
    return new Promise((resolve, reject) => {
      const formData = new Map();
      bb.on('field', (name, value, { nameTruncated, valueTruncated }) => {
        if (nameTruncated) {
          reject(new Error(`Field name size exceeded: ${limits.fieldNameSize} bytes`));
        }
        if (valueTruncated) {
          reject(new Error(`Field value size exceeded: ${limits.fieldSize} bytes`));
        }
        formData.set(name, value)
      })
      bb.on('fieldsLimit', () => {
        reject(new Error(`Fields limit exceeded: ${limits.fields}`));
      })
      bb.on('file', (name, fileStream, { filename, mimeType }) => {
        const chunks = [];
        fileStream.on('limit', () => {
          reject(new Error(`File size limit exceeded: ${limits.fileSize} bytes`));
        })
        fileStream.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        })
        fileStream.on('close', () => {
          if (fileStream.truncated) {
            reject(new Error(`File size limit exceeded: ${limits.fileSize} bytes`));
          }
          const file = new File(chunks, filename, { type: mimeType });
          formData.set(name, file);
        });
      })
      bb.on('filesLimit', () => {
        reject(new Error(`Files limit exceeded: ${limits.files}`));
      })
      bb.on('partsLimit', () => {
        reject(new Error(`Parts limit exceeded: ${limits.parts}`));
      })
      bb.on('close', () => {
        resolve(formData);
      });
      bb.on('error', err => {
        reject(err);
      })
      nodeReadable.pipe(bb);
    })
  }
}
