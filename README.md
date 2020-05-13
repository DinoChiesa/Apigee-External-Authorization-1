# Externalizing API Authorization with Apigee

The Apigee API Platform includes a configurable smart proxy service. People
often think of this as a gateway.

People use the Apigee gateway for many purposes. A typical technical use case is
to  enforce authorization policies for inbound calls, before proxying to an
upstream system. A good pattern is:

1. Externalize the authorization decisions, perhaps in an external
   authorization database table, service, or rules engine.

   - Each rule can be modeled as a tuple of {subject, object, action}, related
     to a binary allow/deny decision. In an HTTP REST API, the subject is the
     client and the end user (if any); the object is the resource, represented
     by the url path; and the action is the HTTP verb: GET, PUT, POST, DELETE.

   - applying the rules is as simple as finding a match for the tuple, and
     selecting the allow/deny result.

2. Configure the Apigee API Proxy to call out to that external system to
   obtain the authorization decision.

3. Enforce the authorization decision within the API Proxy.

This is really straightforward to do, with Apigee, relying on such capabilities as:
- OAuthV2 token verification to obtain client and user identity

- Calls to external services within the scope of a request, via the
  ServiceCallout policy.

- Conditional flows, allowing different responses based on context.

## This Demonstration

This repository includes a working illustration of this pattern: externalized
authorization decisions, enforced in the gateway.

The implementation here is an Apigee proxy that:
- receives a request
- calls out to an authorization service to read the permission rules,
- and then evaluates the permissions for the given request.

We might call the external list of rules the "Policy Decision Point" and the
gateway, the "Policy Execution Point".

To see a screencast walkthrough of this demonstration, [click here](https://youtu.be/ZnCOWuYiF5g):

[![Watch the video](https://img.youtube.com/vi/ZnCOWuYiF5g/maxresdefault.jpg)](https://youtu.be/ZnCOWuYiF5g)

## This Implementation

The main proxy is `abac-demo`.
This receives inbound requests from a client. The inbound request includes a
verb and path (implicit in the HTTP request), and
a queryparam named `role`.  Really, the API Proxy should infer the `role` from
some other credential the client app passes, but this is a demonstration.

The `abac-demo` proxy:

1. uses FlowCallout to retrieve the ABAC rules

2. uses a JavaScript callout to evaluate the rules, based on the
   {verb, path role} tuple

3. conditionally raises a fault if access is not allowed


There is a second proxy, `cloud-sheets-abac`.  Its purpose is to
provide an alternative mechanism for demonstrating the ABAC rules. It
accepts only a GET on /permission , and allows the caller to
explicitly pass in the resource (aka path), role and action to
evaluate. It does the same thing as the `abac-demo` proxy , but uses
different inputs.


Both proxies depend on the shared flow called `Get-ABAC-Rules` to
retrieve the ABAC rules.  That shared flow is just a sequence of
steps:

  - look in the cache for cached rules

  - if not present, retrieve the rules from a sheet, and  store the
    result in cache

  - set a context variable `abac_rules` to contain the rules


There is one additional shared flow, `Get-GCP-Token` , which `Get-ABAC-Rules`
uses to retrieve and cache a GCP access token, if there is no cached ruleset.


## A Google Sheet?! To store Enterprise Authorization rules?

The implementation here uses a Google spreadsheet to hold the
permissions definition, and Apigee calls into that sheet to read
it. Of course, the store could be replaced with any alternative
implementation that can be reached via HTTPS.

You might think that a spreadsheet is a cute way to demonstrate this idea, but
is not appropriate for use within an enterprise. Don't be too quick. Before
dismissing the use of a spreadsheet to hold enterprise critical information,
please note:

- The table metaphor in a spreadsheet is a very clean way to represent ALLOW &
  DENY tuples. Each of {subject, object, action, decision} is a column. A row
  in the sheet represents a single rule. Even with thousands or tens of
  thousands of rows, the sheet will meet the need nicely.

- The API for the spreadsheet to inquire the rules is already built, documented,
  and provided for you by Google. It will deliver excellent availability and
  security.

- It's very easy for operators to read or update the rules using a Web UI - an
  easy-to-use tool they already know.

- Google keeps back versions of the rules automatically. Rollback is brain dead
  easy.

- The cost of keeping this sheet in the cloud is very low.

- Enterprise security for write access to the spreadsheet is already guaranteed,
  with role-based edit rights and so on. Also, Google automatically keeps an
  audit trail of who changed what.

In short, a Google sheet is a good fit for storing
authorization rules.



## Focus on the Pattern

While I think using a Sheet to store the rules can be an effective
approach, you don't have to agree. In any case that is not the main
point of this demonstration. Please focus on the general pattern, not
on the implementation. The pattern is: Apigee implementing
authorization policy decisions provided by an externalized service.


## Provisioning

There are two classes of setup required:

* the Google cloud things including a Google Sheet, as well as a
  service account that can access that sheet.

* The Apigee-specific things, including proxies and sharedflows, etc.

The following subsections take you through that setup.

### Google Cloud Project Stuff

1. download and install the [gcloud sdk (CLI)](https://cloud.google.com/sdk)

2. create a random project name:
   ```
   PROJECTID=abac-sheets-project-$RANDOM-$RANDOM
   ```

3. create the project in Google Cloud
   ```
   gcloud projects create $PROJECTID
   ```

4. enable the appropriate APIs on that project:
   ```
   gcloud config set project $PROJECTID
   gcloud services enable \
     sheets.googleapis.com drive.googleapis.com
   ```

5. create the service account:

   ```
   gcloud iam service-accounts create apigee-sa-abac-reader
   ```

6. get the email for that service account:
   ```
   gcloud iam service-accounts list
   ```

7. create and download the service account key:
   ```
   gcloud iam service-accounts keys create sa_creds.json \
      --iam-account EMAIL
   ```
   The `EMAIL` must be replaced by the email retrieved from the prior
   step.

   The service account credentials get stored in `sa_creds.json`.
   Protect this file; it contains secrets.  By the way, the specific
   filename `sa_creds.json` is not important; you can use any name you
   please. But you will need the name of that file in
   subsequent steps.

### The Sheet

1. Create the sheet, supplying the `sa_creds.json` file you obtained
   from above:
   ```
   cd tools
   npm install
   node ./createSheet.js --sacreds ../sa_creds.json
   ```

   This will create a sheet, emit the ID of the sheet in the terminal
   session, and then open a browser tab to the sheet. You will need
   the sheetid in a minute.

2. In the browser tab containing the newly created sheet, use the
   "Share" button in the upper right corner to share the
   sheet with the email of the service account, as a `Viewer`.


### Apigee assets

Here, we need to deploy the proxies and the supporting sharedflows,
and also provision the KVM. To do all of this, you need to supply
`sa_creds.json` file and the sheetid that was produced from the above
steps. Pass these to the `./provision.js` script with options, like so:

```
ORG=myorg
ENV=myenv
node ./provision.js -v -u email@example.com -o $ORG -e $ENV \
  --sheetid $SHEETID \
  --sacreds ../sa_creds.json
```

You must pass your Apigee user name to the provisioning script. It
will prompt you for a password.

If you use `.netrc` you can omit the
`-u` option and specify `-n`.

```
ORG=myorg
ENV=myenv
node ./provision.js -v -n -o $ORG -e $ENV \
  --sheetid $SHEETID \
  --sacreds ../sa_creds.json
```

This script will take just a few moments to set all the Apigee things up.

## Invoking

Remember, there are two proxies. Both demonstrate the same thing.

1. To invoke the `cloud-sheets-abac` proxy, in which you must explicitly
   pass the tuple in distinct query params:
   ```
   curl -i "https://$ORG-$ENV.apigee.net/cloud-sheets-abac/permission?role=employee&action=GET&resource=/abac-demo/foo"
   ```

   The possible values:

   | parameter | values                                                          |
   |-----------|-----------------------------------------------------------------|
   | role      | admin, partner, employee, contractor                            |
   | verb      | PUT, POST, GET, DELETE                                          |
   | resource  | any path, but only /abac-demo/foo has ALLOW entries in the sheet, to start. |


2. To invoke the `abac-demo` api proxy in this demonstration:
   ```
   curl -i -X VERB "https://$ORG-$ENV.apigee.net/abac-demo/foo?role=XXXX"
   ```

   For example:
   ```
   curl -i -X POST "https://$ORG-$ENV.apigee.net/abac-demo/foo?role=partner" -d ''
   ```

   This one will use the verb and path from the HTTP request, and the
   role passed as a query parameter.


## Modifying the rules

You can update the sheet, add rules, modify the existing ones, and so
on.  Then invoke the proxies again. The rules are cached for 300
seconds in the API Proxy; after changing the rules, you may have to
wait for cache expiry. To change that TTL, modify the KVM policies in
the get-abac-rules sharedflow.

## Extending the Idea

Imagine an expansion of the idea beyond the Allow/Deny
binary decision. What if the authorization response came back with an
"allowed quota" or score based on some other environmental factor?
Maybe there is a separate, asynchronous task that runs and
periodically updates the rules in the sheet?  What it does, and how it
does it, would be entirely flexible.

Beyond an Allow/Deny action, Apigee might implement a rate limit as
suggested by the external system. The rate limit might change over
time, or be different at different times of the day.

All of this is possible.


## Deprovisioning

You can de-provision the Apigee assets with the `./provision.js`
script:
```
node ./provision.js -v -u email@example.com -o $ORG -e $ENV -R
```

This should remove the sharedflows, the proxies, and the KVM entries.

You are on your own for removing the GCP project, the service
account, and the sheet.

## TODO

* update the provisioning so that it works with Apigee hybrid
