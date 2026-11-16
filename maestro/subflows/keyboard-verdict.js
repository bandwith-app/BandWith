// type-and-check.yaml: turns the keyboard probe's answer (copied from the
// screen) into the text to assert. "bw-kb ok" passes; anything else asserts
// a text that is not on screen, so the failure message carries the reason.
var got = String(maestro.copiedText || '');
output.keyboardExpect =
  got.indexOf('bw-kb ok') === 0
    ? 'bw-kb ok.*'
    : 'Keyboard probe on ' + SHOT + ' - ' + got.replace(/[^A-Za-z0-9 :;"',-]/g, ' ');
