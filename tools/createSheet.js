// createSheet.js
// ------------------------------------------------------------------
//
// created: Tue May 12 15:30:15 2020
// last saved: <2020-May-12 22:16:42>

/* jshint esversion:9, node:true, strict:implied */
/* global process, console, Buffer */

const edgejs   = require('apigee-edge-js'),
      common   = edgejs.utility,
      sprintf  = require('sprintf-js').sprintf,
      dayjs    = require('dayjs'),
      opn      = require('opn'),
      readline = require('readline'),
      fs       = require('fs'),
      fsPromise= require('fs').promises,
      path     = require('path'),
      Getopt   = require('node-getopt'),
      {google} = require('googleapis'),
      dataDir  = path.resolve(__dirname, '../data'),
      getopt   = new Getopt([
        ['' , 'sacreds=ARG', 'Required. the .json service account credentials the proxy will use to read the gsheet.'],
        ['h' , 'help', 'optional. get help']
      ]).bindHelp();

const version          = '20200512-2204',
      clientCreds      = require(path.resolve(dataDir, 'client_credentials.json')),
      rules            = require(path.resolve(dataDir, 'startingRules.json')).rules,
      GOOG_APIS_SCOPES = ['https://www.googleapis.com/auth/drive.file'],
      today            = dayjs(new Date()).format('YYYY-MMM-DD');

function getNewGoogleapisToken(oAuth2Client, tokenStashPath, cb) {
  console.log('\nYou must authorize the ABAC Rules Sheet Setup to create a new sheet.\n');
  console.log('This script will now open a browser tab. After granting consent, you will');
  console.log('receive a one-time code. Return here and paste it in, to continue....\n');

  new Promise((resolve) => setTimeout(resolve, 4200))
    .then(() => {
    const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: GOOG_APIS_SCOPES
          });
    // Authorize this app by visiting the url
    opn(authUrl, {wait: false});
    const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
    rl.question('Paste the one-time-code: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, (e, token) => {
        if (e) return cb(e);
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFile(tokenStashPath, JSON.stringify(token, null, 2) + '\n', (e) => {
          if (e) console.error(e); // this is a non-fatal condition
        });
        cb(oAuth2Client);
      });
    });
  });
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function oauth2Authorize(credentials, cb) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const tokenStashPath = path.resolve(dataDir, ".gsheets_token_stash.json");

  // Check if there is a previously stashed token.
  fs.readFile(tokenStashPath, (e, token) => {
    if (e){
      // ENOEXIST and etc, get a new token
      return getNewGoogleapisToken(oAuth2Client, tokenStashPath, cb);
    }

    oAuth2Client.setCredentials(JSON.parse(token));
    cb(oAuth2Client);
  });
}

function handleError(e) {
  if (e) {
    console.log('Error: ' + JSON.stringify(e, null, 2));
    process.exit(1);
  }
}


common.logWrite('start');
let opt = getopt.parse(process.argv.slice(2));
if ( ! opt.options.sacreds) {
  console.log('you must specify a Service Account credentials file.');
  getopt.showHelp();
  process.exit(1);
}

fsPromise.readFile(opt.options.sacreds, 'utf8')
  .then(saCreds => {
    if (saCreds) { saCreds = JSON.parse(saCreds); }
    if( ! saCreds || !saCreds.project_id || !saCreds.client_email) {
      return Promise.reject(new Error('Cannot read the Service Account creds file.'));
    }

    common.logWrite('\nCreating a new spreadsheet on Google sheets...');
    oauth2Authorize(clientCreds, (auth) => {
      const sheets = google.sheets({version: 'v4', auth});
      const sheetTitle = "Rules";
      var request = {
            resource: {
              properties : {
                title: `ABAC Rules [created ${today}]`
              },
              sheets : [
                {
                  properties: { sheetId : 0, title: sheetTitle }
                }
              ]
            }
          };
      sheets.spreadsheets.create(request, function(e, createResponse) {
        handleError(e);
        let spreadsheetId = createResponse.data.spreadsheetId;
        let values = [['Role', 'Resource', 'Action', 'Allow']].concat(rules);
        let update1 = {
              spreadsheetId,
              valueInputOption: 'USER_ENTERED',
              range: sprintf("%s!R[0]C[0]:R[%d]C[%d]",
                             sheetTitle, rules.length + 1, rules[0].length),
              resource: { values }
            };
        sheets.spreadsheets.values.update(update1, (e, updateResponse) => {
          handleError(e);
          let range = {
                sheetId: 0,
                startRowIndex: 0,    endRowIndex: 1,
                startColumnIndex: 0, endColumnIndex: 4
              };
          let batch = {
                spreadsheetId,
                resource: {
                  requests: [
                    {
                      // add a bottom border to the header row
                      updateBorders: {
                        range,
                        bottom: {
                          style: "SOLID",
                          width: 2,
                          color: {
                            red: 0.0,
                            green: 0.0,
                            blue: 0.0
                          }
                        }
                      }
                    },
                    {
                      // bold the header row
                      repeatCell: {
                        range,
                        cell: {
                          userEnteredFormat: {
                            textFormat: {
                              bold: true
                            }
                          }
                        },
                        fields: "userEnteredFormat(textFormat)"
                      }
                    }
                  ]
                }
              };

          sheets.spreadsheets.batchUpdate(batch, function(e, _) {
            let sheetUrl = sprintf('https://docs.google.com/spreadsheets/d/%s/edit',
                                   createResponse.data.spreadsheetId);
            console.log();
            common.logWrite(`sheet id: ${createResponse.data.spreadsheetId}`);
            common.logWrite(`sheet url: ${sheetUrl}`);
            common.logWrite(`Share that sheet with this email: ${saCreds.client_email}`);
            opn(sheetUrl, {wait: false});
          });
        });
      });
    });

  });
