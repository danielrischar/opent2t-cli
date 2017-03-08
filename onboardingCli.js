/* jshint esversion: 6 */
/* jshint node: true */
'use strict';
var inquirer = require('inquirer');
var helpers = require('./helpers');
var q = require('q');
var state = "opent2t-cli";
var cliVars = [{ "key": "{state}", "value": state}];

class OnboardingCli {
    constructor() {
        this.OpenT2T = require('opent2t').OpenT2T;
    }

    // loads the specified translator and performs the onboarding for it
    doOnboarding(translatorName) {
        var LocalPackageSourceClass = require('opent2t/package/LocalPackageSource').LocalPackageSource;
        var localPackageSource = new LocalPackageSourceClass("./node_modules/" + translatorName);

        return localPackageSource.getAllPackageInfoAsync().then((packages) => {

            // default use the first package
            var p = packages[0];
            if (p.translators.length > 0) {

                var tinfo = p.translators[0];
                console.log("----------------------------- Package Info");
                helpers.logObject(tinfo);
                console.log("-----------------------------");

                var Onboarding = require(tinfo.onboarding);
                var onboarding = new Onboarding();
                return this.performFlow(onboarding, tinfo.onboardingFlow).then(answers => {
                    return onboarding.onboard(answers);
                });
            }
        });
    }

    // loads the first package found under opent2t/package for a given translator
    // TODO: refactor doOnboarding to call into this instead to avoid code-duplication
    loadTranslatorAndGetOnboardingAnswers(translatorName){
        var LocalPackageSourceClass = require('opent2t/package/LocalPackageSource').LocalPackageSource;
        var localPackageSource = new LocalPackageSourceClass("./node_modules/" + translatorName);

        return localPackageSource.getAllPackageInfoAsync().then((packages) => {
            
            // default use the first package
            var p = packages[0];
            if (p.translators.length > 0) {

                var tinfo = p.translators[0];
                console.log("----------------------------- Package Info");
                helpers.logObject(tinfo);
                console.log("-----------------------------");
                
                var onboardingAnswers = [];
                
                // TODO: initialize an onboarding here
                var Onboarding = require(tinfo.onboarding);
                var onboarding = new Onboarding();
                return this.performFlow(onboarding, tinfo.onboardingFlow, 1, onboardingAnswers);
            }
        });
    }

    // does the onboarding flow and asks the user any input
    performFlow(onboarding, onboardingFlow, i, onboardingAnswers) {
        if (!!!i) {
            i = 0;
        }

        if (!!!onboardingAnswers) {
            onboardingAnswers = [];
        }

        // recursive ending condition
        if (i >= onboardingFlow.length) {
            var deferred = q.defer();
            deferred.resolve(onboardingAnswers);
            return deferred.promise;
        }

        var flowItem = onboardingFlow[i];
        console.log("--------------- %j".header, flowItem.name);

        if (flowItem.name === "getDeveloperInput" || flowItem.name === "getUserInput") {
            var inquirerInput = this.convertFlowToInquirer(flowItem);
            return inquirer.prompt(inquirerInput).then(answers => {
                onboardingAnswers.push(answers);
                return this.performFlow(onboarding, onboardingFlow, i + 1, onboardingAnswers);
            });
        }
        else if (flowItem.name === "askUserPermission") {
            // create the url by resolving variables with values retrieved
            // todo where to put these helper methods?
            
            // Always use flow[0] for backwards compatibility
            var flow = {
                description: flowItem.flow[0].descriptions.en,
                name: flowItem.flow[0].name,
            }

            return this.getUrl(onboarding, flow, onboardingAnswers).then((url) => {
                // start server and route to url
                return this.doWebFlow(url).then(returnUrl => {
                    onboardingAnswers.push(returnUrl);
                    return this.performFlow(onboarding, onboardingFlow, i + 1, onboardingAnswers);
                });
            });
        }
        else {
            console.log("Unsupported flow element: " + flowItem.name);
            return this.performFlow(onboarding, onboardingFlow, i + 1, onboardingAnswers);
        }
    }

    /**
     * Gets either a static URL from the manifest, or asks the onboarder to create one.
     */
    getUrl(onboarding, flow, answers) {
        if (flow.name === 'url') {
            var replaceVars = this.getReplaceVars(answers);
            return Promise.resolve(this.replaceVarsInValue(flow.description, replaceVars));
        } else if (flow.name === 'method') {
            return onboarding[flow.description](answers);
        }
    }

    // this resolves variables in the onboarding flow with dynamic values retreived from the user
    // takes in a key/value pair array and replces any key found in the string with the value in the array
    // input
    // my cool string with {key1} things to replace inside {key2} it
    // {key1} : value1
    // {key2} : value2
    // output
    // my cool string with value1 things to replace inside value2 it
    replaceVarsInValue(value, replaceVars) {
        var toReturn = value;
        for (var i = 0; i < replaceVars.length; i++) {
            var replaceItem = replaceVars[i];
            toReturn = toReturn.replace(replaceItem.key, replaceItem.value);
        }

        return toReturn;
    }

    // given the users answers, creates a {key}/value array
    getReplaceVars(answers) {
        var replaceVars = cliVars.slice(0);

        for (let i = 0; i < answers.length; i++) {
            let answer = answers[i];
            for (var property in answer) {
                if (answer.hasOwnProperty(property)) {
                    replaceVars.push({ "key": "{" + property + "}", "value": answer[property] });
                }
            }
        }

        return replaceVars;
    }

    // converts opent2t onboarding flow into multiple inquirer flows
    // onboardingFlow has two levels, inquirer only handles one level
    // so we convert into multiple one level sets
    convertFlowToInquirer(flowItem) {
        var inquirerInput = [];

        for (var j = 0; j < flowItem.flow.length; j++) {
            var element = flowItem.flow[j];
            var iItem = {};

            if (!!element.type) {
                iItem.type = element.type;
            }
            else {
                iItem.type = "input";
            }

            iItem.name = element.name;
            iItem.message = element.descriptions.en;

            inquirerInput.push(iItem);
        }

        return inquirerInput;
    }

    // starts a web server at the configured port and waits for /success call
    doWebFlow(url) {
        var deferred = q.defer();
        var open = require('open');
        var express = require('express');
        var port = 8080;
        var app = express();

        app.get("/success", function(req, res) {
            res.send("success!");

            console.log("State verification: " + (req.query.state === state));

            helpers.logObject(req.url);
            deferred.resolve(req.url);
        });

        app.listen(port, function() {
            console.log("Server running on port", port);
            console.log("Waiting for success call from web page");

            open(url);
        });

        return deferred.promise;
    }
}

module.exports = OnboardingCli;