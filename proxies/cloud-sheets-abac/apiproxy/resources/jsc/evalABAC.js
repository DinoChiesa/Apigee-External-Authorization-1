/* jshint esversion:6, node:true, strict:implied */
/* global context, properties */

function evalABAC(rules, role, resource, action) {
  // rules is an array of arrays; the inner array is a tuple of
  //   [ role, resource, verb, allowed ]
  //
  // eg
  //   [ [ 'partner', '/v1/foo', 'GET', 'TRUE' ],
  //     [ 'employee', '/v1/foo', 'GET', 'TRUE' ],
  //     [ 'employee', '/v1/foo', 'POST', 'TRUE' ],
  //     [ 'employee', '/v1/foo', 'DELETE', 'FALSE' ],
  //     [ 'admin', '/v1/foo', 'DELETE', 'FALSE' ] ]

  var allowed = null;
  rules.forEach(function(rule) {
    if (allowed == null) {
      if (rule && rule.length == 4) { // sanity
        if (rule[0]==role) {
          if (rule[1]==resource) {
            if (rule[2]==action) {
              allowed = rule[3];
            }
          }
        }
      }
    }
  });
  return (allowed!=null && allowed.toLowerCase()=='true');
}

var variableReference = new RegExp('^(.*){([^ ,}]+)}(.*)$');

function resolveVariableRefs(template) {
  var match;
  while ((match = template.match(variableReference))) {
    if (match[2]) {
      template = match[1] + context.getVariable(match[2]) + match[3];
    }
  }
  return template;
}

var rules = JSON.parse(context.getVariable('abac_rules'));
var subject = resolveVariableRefs(properties.subject);
var resource = resolveVariableRefs(properties.resource);
var action = resolveVariableRefs(properties.action);
var allowed = evalABAC(rules, subject, resource, action);

context.setVariable('abac_subjectrole', subject);
context.setVariable('abac_resource', resource);
context.setVariable('abac_action', action);
context.setVariable('abac_allowed', String(allowed));
