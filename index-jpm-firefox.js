/* The background process for Firefox when built with JPM */

/* 
For reference, look at https://github.com/darthkrallt/AO3rdr/blob/5b9d1239cb5ccd9a6ebd68ea409a0c5b885db4e2/lib/main.js
    Needed:
    - storage interface
    - port listener
    Key differences:
    - broadcast/listen all CANNOT work the same way. Only port messaging.
    - ficdict is still in use!
    - need to attach workers on launch
    - settings page (settingsclick) needs manual attachment of scripts

*/

// var data = require('sdk/self').data; // I do NOT think this was ever used....
var self = require("sdk/self");
var simpleStorage = require('sdk/simple-storage');
var pageMod = require("sdk/page-mod");
var pageWorker = require("sdk/page-worker");
var tabs = require("sdk/tabs");
var system = require("sdk/system");


var workerList = [];

/*
    "message" is a dictionary formatted like this:
        {'message': message, 'data': data, 'data_type': data_type}
    only the 'message' field is mandatory
*/
function broadcast(message){
    for (var worker in workerList){
        worker.port.emit(message['message'], message);
    }
}

/*
    callbackMessage is intended to do port message passing as a callback
        You have to call this twice to get it to send, first with the port,
        second with the data you want to send
*/
var callbackMessage = (function(port){
    return function(message, data, data_type) {
        port.emit(message, {'message': message, 'data': data, 'data_type': data_type});
    };
});

/*
    This is a way to make simple storage look like chrome storage.
    TODO: Is it a terrible idea to override get and set like this?

    WARNING: Key difference!
        Firefox is still keeping things in the ficdict, instead of
            individual items
        TODO: fix this?
        ex: simpleStorage.storage.ficdict 
*/
var storage = {
    // expects the callback to be passed an object matching
    // {key: STUFF}
    get: function(key, callback) {
        var simpleStorage = require('sdk/simple-storage');
        var out = {};
        out[key] = simpleStorage.storage[key];
        callback(out);
    },
    // I don't know if there's a callback for set...
    // for every key passed in to set, set it in simplestorage
    set: function(dictionary) {
        var simpleStorage = require('sdk/simple-storage');    
        for (var key in dictionary) {
            if (dictionary.hasOwnProperty(key)) {
                simpleStorage.storage[key] = dictionary[key];
            }
        }
    }
};


function onAttachFun(worker) {
    /* This function contains logic for handling all incoming messages. */
    worker.postMessage('test message');
    workerList.push(worker);
    worker.on('detach', function () {
        detachWorker(this, workerList);
    });

    worker.port.on('settingsclick', function() {
        var newTab = tabs.open(self.data.url('./settings/index.html'));
    });
    worker.port.on('test incomming message', function(args) {
        // You may also pass data as a second argument to 'emit'
        worker.port.emit('test outgoing message');
    });
    worker.port.on('reveal-token', function() {
        getUser(callbackMessage(this.port));
    });
    worker.port.on('save-token', function(request) {
        validateAndSaveToken(request.data, this.port);
    });
    worker.port.on('prefs', function(request) {
        savePrefs(request.data);
    });
    worker.port.on('fetchdata', function(request) {
        fetchDataRequest(request, this.port);
    });
    worker.port.on('restorefrombackup', function(request) {
        restoreFromBackup(request);
    });
    worker.port.on('ficdata', function(request) {
        handleNewFic(request.data.metadata, request.data.mutable_data, port);
    });
    worker.port.on('runsync', function() {
        runSync();
    });
}


// Create a page mod
// It will run a script whenever a ".org" URL is loaded
// The script replaces the page contents with a message

// Modify the pages of AO3 to show the addon stuff. Also attaches the workers who
// do the message passing.
var setupAO3 = pageMod.PageMod({
    // TODO: get this pattern to match more specifically to the pages we're working on
    include: "http://archiveofourown.org/*", "https://archiveofourown.org/*",
    contentScriptWhen: 'ready',
    contentScriptFile: [data.url('jquery-1.11.2.min.js'),
                        self.data.url("./toolbar-ao3.js"),
                        self.data.url("./ao3lib.js"),],
    // We actually want this on any page load of the site
    onAttach: onAttachFun,
});

// All the scripts for running the settings page need are attached here because
// they're special snowflakes that do message passing to main.js
var settingsPage = tabs.on('ready', function(tab) {
    // Don't attach settings page workers unless it's the settings page!
    if (!endsWith(tab.url, 'ao3rdr/data/settings/index.html')) {
        return;
    }
    worker = tab.attach({
        // TODO: not sure if need to specify all libs here
        contentScriptFile: [self.data.url('./lib/jquery-1.11.2.min.js'),
                            self.data.url('./data/settings/jquery.tagsinput.js'),
                            self.data.url("./data/settings/articles-table.js"),
                            self.data.url('./lib/spin.js'),],
        // TODO: make sure that the callbackMessage function works
        // if not you'll have to do the following:
        // onAttach: function(worker) { 
        //     // are you supposed to use "worker" or "this"?
        //     workerList.push(worker);
        //     worker.on('detach', function () {
        //         detachWorker(this, workerList);
        //     });
        //     var callbackfun = (function(parentWorker, port) {
        //         return function() {
        //             port.emit('test emit');
        //         };
        //     })(worker, worker.port);
        //     worker.port.on('test callback', function(port) {
        //         callbackfun();
        //     });

        // },
        onAttach: onAttachFun,
        onClose: function(worker) {
            detachWorker(worker, workerList);
        },
    });
});
