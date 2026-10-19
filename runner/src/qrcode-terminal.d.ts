/** Types for the one `qrcode-terminal` call the listener makes; the package ships none. */
declare module 'qrcode-terminal' {
  const qrcode: { generate(text: string, options?: { small?: boolean }): void };
  export default qrcode;
}
