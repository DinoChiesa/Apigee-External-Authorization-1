
/* jshint esversion:6, node:true, strict:implied */
/* global context */

var c = JSON.parse(context.getVariable('private.credentialsjson'));
for (var prop in c) {
  context.setVariable('private.' + prop, c[prop]);
}
