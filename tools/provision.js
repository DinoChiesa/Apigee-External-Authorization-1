#! /usr/local/bin/node

// provision.js
// ------------------------------------------------------------------
//
// provision an Apigee organization with several proxies and sharedflows,
// for the Google Sheets ABAC example.
//
// Copyright 2017-2020 Google LLC.
//

/* jshint esversion: 9, strict:implied, node:true */

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// last saved: <2020-May-12 22:30:47>

const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      util       = require('util'),
      fs         = require('fs').promises,
      path       = require('path'),
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20200512-2204',
      assets = {
        proxies: ['abac-demo', 'cloud-sheets-abac'],
        sharedflows : ['get-gcp-token', 'get-abac-rules']
      },
      settings   = {
        secretsMap: 'secrets',
        keys : {
          sacreds : 'sheets_abac_credentials_json',
          sheetid : 'sheets_abac_sheet_id'
        }
      },
      homeDir   = path.resolve(__dirname, '..'),
      getopt     = new Getopt(common.commonOptions.concat([
        ['R' , 'reset', 'Optional. Reset, delete all the assets previously provisioned by this script.'],
        ['' , 'sheetid=ARG', 'Required. The id of the google sheet that contains the Authorization rules.'],
        ['' , 'sacreds=ARG', 'Required. the .json service account credentials the proxy will use to read the gsheet.'],
        ['e' , 'env=ARG', 'Required. the Apigee environment to provision for this example. ']
      ])).bindHelp();

// ========================================================

function insureOneMap(org, r, mapname, encrypted) {
  if (r.indexOf(mapname) == -1) {
    return org.kvms.create({ environment: opt.options.env, name: mapname, encrypted})
      .then( () => r );
  }
  return r;
}

function storeSettings(org) {
  return fs.readFile(opt.options.sacreds, 'utf8')
    .then( contents =>
           org.kvms.put({
             environment: opt.options.env,
             kvm: settings.secretsMap,
             key: settings.keys.sacreds,
             value: contents
           }))
    .then( _ => org.kvms.put({
             environment: opt.options.env,
             kvm: settings.secretsMap,
             key: settings.keys.sheetid,
             value: opt.options.sheetid
           }));
}

function removeSettings(org) {
  return Promise.resolve({})
    .then( _ =>
           org.kvms.removeEntry({
             environment: opt.options.env,
             kvm: settings.secretsMap,
             key: settings.keys.sacreds
           })
           .catch( e => {}))

    .then( _ =>
           org.kvms.removeEntry({
             environment: opt.options.env,
             kvm: settings.secretsMap,
             key: settings.keys.sheetid
           })
           .catch( e => {}));
}

function revEnvReducer(collection, name, revision) {
  return (p, deployment) =>
    //console.log('deployment: ' + util.format(deployment));
  p.then( _ => collection.undeploy({name, revision, environment: deployment.environment || deployment.name}));
}

function getRevisionUndeployReducer(collection, name) {
  return (p, revision) =>
    p.then( _ =>
            // morph to support GAAMBO or legacy API
            collection.getDeployments({ name, revision }))
    .then( r => r.deployments || r.environment)
    .then( deployments => {
      //console.log('deployments: ' + util.format(deployments));
      return (deployments && deployments.length > 0) ?
        deployments.reduce(revEnvReducer(collection, name, revision), Promise.resolve()) :
        {};
    });
}

function undeployReducer(org, collectionName) {
  return (p, item) =>
    p
    // support either GAAMBO or legacy API
    .then( _ =>
           org[collectionName].getRevisions({ name: item.name || item}))
    .then( revisions =>
           revisions.reduce(getRevisionUndeployReducer(org[collectionName], item.name || item), Promise.resolve()))
    .then( _ => org[collectionName].del({ name: item.name || item}) )
    .catch( e => {});
}

function deployReducer(org, collectionName) {
  return (p, item) =>
    p
    .then( _ =>
           org[collectionName]
           .import({source: path.resolve(homeDir, collectionName, item)})
           .then( r => org[collectionName].deploy({name:r.name, revision:r.revision, environment:opt.options.env, delay:8 }) ));
}

console.log(
  'Apigee Edge ABAC Example Provisioning tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');
let opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

if ( ! opt.options.env) {
  console.log('you must specify an environment.');
  getopt.showHelp();
  process.exit(1);
}

if ( ! opt.options.reset) {
  if ( ! opt.options.sheetid) {
    console.log('you must specify a sheetid.');
    getopt.showHelp();
    process.exit(1);
  }

  if ( ! opt.options.sacreds) {
    console.log('you must specify a Service Account credentials file.');
    getopt.showHelp();
    process.exit(1);
  }
}

apigeeEdge.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');
    if (opt.options.reset) {
      const reducer = (p, key) =>
        p .then( accumulator =>
                 assets[key]
                 .reduce(undeployReducer(org, key), Promise.resolve([])));
      return Promise.resolve({})
        .then( _ => ['proxies', 'sharedflows'] .reduce(reducer, Promise.resolve([])))
        .then( _ => removeSettings(org))
        .then( _ => common.logWrite(sprintf('ok. demo assets have been deleted')) );
    }

    const reducer = (p, key) =>
      p.then( accumulator =>
               assets[key]
               .reduce(deployReducer(org, key), Promise.resolve([])));
    return Promise.resolve({})
      .then( _ => org.kvms.get({ environment: opt.options.env }))
      .then( r => insureOneMap(org, r, settings.secretsMap, true))
      .then( _ => storeSettings(org))
      .then( _ => ['sharedflows', 'proxies'] .reduce(reducer, Promise.resolve([])))
      .then( _ => common.logWrite(sprintf('ok. demo assets have been deployed')) );

  })
  .catch( e => console.log(util.format(e)) );
