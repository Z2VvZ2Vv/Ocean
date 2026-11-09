export default import.meta.glob('/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}', {
  query: '?url', import: 'default', eager: true,
})
