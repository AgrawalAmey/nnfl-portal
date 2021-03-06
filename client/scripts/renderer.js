// Load vender scripts
const { app } = require('electron');
const crypto = require('crypto')
const ejse = require('ejs-electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('request')

// Load custom scripts
const condaInstaller = require('./condaInstaller')
const config = require('../config')
const creds = require('./creds.js')
const { exec, execSync } = require('child_process')
const remoteServerAddrHandler = require('./remoteServerAddrHandler')

function Renderer(mainWindow){
    self = this

    this.platform = os.platform()
    this.mainWindow = mainWindow

    ejse.data('appVersion', config.version)
    
    this.render = () => {
        var remoteServerAddr = remoteServerAddrHandler.getRemoteServerAddr();

        if (condaInstaller.isInstalled()) {
            this.checkRemoteServerAddressAndRender(remoteServerAddr)
        } else {
            this.renderCondaInstaller(undefined)
            condaInstaller.install((err) => {
                if (err) {
                    self.renderCondaInstaller("Installation failed.")
                    return;
                } else {
                    self.checkRemoteServerAddressAndRender(remoteServerAddr)
                }
            })
        }
    }

    this.checkRemoteServerAddressAndRender = (remoteServerAddr) => {

        var remoteServerURL = "http://" + remoteServerAddr + "/login"

        var options = {
            url: remoteServerURL,
            timeout: 500,
            headers: {
                'cache-control': 'no-cache'
            }
        }

        // For the first time case
        if (remoteServerAddr == '') {
            this.renderRemoteServerAddr('', '')
            return;
        }

        request(options, (err, body, res) => {
            if (err) {
                console.log(err);
                // Render retry page
                self.renderRemoteServerAddr('Cannot connect to remote server', remoteServerAddr)
                return;
            }
            // Save address
            remoteServerAddrHandler.saveRemoteServerAddr(remoteServerAddr);
            // Render webview
            self.renderWebview(remoteServerURL)
        });
    }

    this.renderRemoteServerAddr = (message, remoteServerAddrPlaceholder) => {
        ejse.data('remoteServerAddrPlaceholder', remoteServerAddrPlaceholder);
        ejse.data('message', message);
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'remoteAddr.ejs'));
    }

    this.renderWebview = (remoteServerURL) => {
        ejse.data('remoteServerAddr', remoteServerURL);
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'webview.ejs'));
    }

    this.renderCondaInstaller = (message) => {
        ejse.data('condaInstallError', message)
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'condaInstaller.ejs'));
    }

    this.renderAssignmentDownloader = (message) => {
        ejse.data('assignmentDownloadError', message)
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'assignmentDownloader.ejs'));
    }

    this.renderNotebookIndex = (assignment, notebook, type, modalError) => {
        // assignment.name = assignment.name.replace(/ /g, "%20")
        // notebook.name = notebook.name.replace(/ /g, "%20")

        var jupyterAddr = require('../config').jupyterAddr
        if (type == 'problems'){
            var notebookURL = "http://" + jupyterAddr + "/notebooks/" + creds.getCreds().username + "/release/" + assignment.name + "/" + notebook.name;
        } else {
            var notebookURL = "http://" + jupyterAddr + "/notebooks/" + creds.getCreds().username + "/source/" + assignment.name + "/" + notebook.name;
        }

        tokenFile = path.join(app.getPath('temp'), 'tokenFile.txt');

        fs.readFile(tokenFile, (err, data) => {
            if (err) {
                var token = crypto.randomBytes(20).toString('hex');
                fs.writeFile(tokenFile, token, (err) => {
                    if (err) {
                        throw err;
                    } else {
                        checkAndStartJupyter(token, assignment, notebook, type, modalError, notebookURL)
                    }
                });
            } else {
                var token = data.toString();
                checkAndStartJupyter(token, assignment, notebook, type, modalError, notebookURL)
            }
        });
    }

    checkAndStartJupyter = (token, assignment, notebook, type, modalError, notebookURL) => {
        var jupyterAddr = config.jupyterAddr;
        notebookURL = notebookURL + '?token=' + token;
        var opts = {
            url: 'http://' + jupyterAddr,
            qs: {
                token: token
            },
            timeout: 500,
            headers: {
                'cache-control': 'no-cache'
            }
        }

        request(opts, (err, response, body) => {
            if (err) {
                var userDataPath = path.join(app.getPath('userData'), 'assignments')
                var jupyterPort = jupyterAddr.split(":")[1]
                if (this.platform == 'win32') {
                    var jupyterPath = path.join(condaInstaller.getInstallationPath(), 'Scripts', 'jupyter-notebook.exe')
                } else {
                    var jupyterPath = path.join(condaInstaller.getInstallationPath(), 'bin', 'jupyter') + ' notebook'
                }
                var notebookCmd = jupyterPath + " --NotebookApp.token=\"" + token + "\" --notebook-dir=\"" + userDataPath + "\" --no-browser --port=" + jupyterPort;
                var child = exec(notebookCmd);
                wrapper(assignment, notebook, type,  modalError, notebookURL, child);
            } else {
                loadNotebookURL(assignment, notebook, type,  modalError, notebookURL);
            }
        });
    }

    wrapper = (assignment, notebook, type, modalError, notebookURL, child) => {
        var buffer = '';

        stderrHandler = (data, cb) => {
            buffer = buffer + data;
            if(buffer.includes('The Jupyter Notebook is running at')) {
                loadNotebookURL(assignment, notebook, type, modalError, notebookURL);
                buffer = '';
                child.stderr.removeListener('data', stderrHandler);
            }
        }

        child.stderr.on('data', stderrHandler);
    }

    loadNotebookURL = (assignment, notebook, type, modalError, notebookURL) => {
        if (modalError) {
            ejse.data('modalError', modalError);
        } else {
            ejse.data('modalError', null);
        }
        ejse.data('assignment', assignment);
        ejse.data('notebook', notebook);
        ejse.data('type', type)
        ejse.data('notebookURL', notebookURL);
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'notebook.ejs'));
    }

    this.renderAssignmentIndex = (assignment) => {
        var config = require('../config');
        var remoteServerAddr = config.remoteServerAddr;
        var remoteServerURL = "http://" + remoteServerAddr + '/assignment?name=' + assignment.name

        this.renderWebview(remoteServerURL);
    }

    this.renderPracticeIndex = () => {
        var remoteServerAddr = config.remoteServerAddr;
        var remoteServerURL = "http://" + remoteServerAddr + '/practice';

        this.renderWebview(remoteServerURL);
    }

    this.renderPracticeNBIndex = (notebook) => {
        notebook = notebook.replace(/ /g, "%20")

        var jupyterAddr = require('../config').jupyterAddr
        var practiceNBURL = "http://" + jupyterAddr + "/notebooks/practice/" + notebook

        tokenFile = path.join(app.getPath('temp'), 'tokenFile.txt');

        fs.readFile(tokenFile, (err, data) => {
            if (err) {
                var token = crypto.randomBytes(20).toString('hex');
                fs.writeFile(tokenFile, token, (err) => {
                    if (err) {
                        throw err;
                    } else {
                        checkAndStartJupyterPractice(notebook, token)
                    }
                });
            } else {
                var token = data.toString();
                checkAndStartJupyterPractice(notebook, token)
            }
        });
    }

    checkAndStartJupyterPractice = (notebook, token) => {
        var jupyterAddr = config.jupyterAddr;
        var practiceNBURL = "http://" + jupyterAddr + "/notebooks/" + creds.getCreds().username + "/practice/" + notebook + '?token=' + token;
        var opts = {
            url: 'http://' + jupyterAddr,
            qs: {
                token: token
            },
            timeout: 500,
            headers: {
                'cache-control': 'no-cache'
            }
        }

        request(opts, (err, response, body) => {
            if (err) {
                var userDataPath = path.join(app.getPath('userData'), 'assignments')
                var jupyterPort = jupyterAddr.split(":")[1]
                if (this.platform == 'win32') {
                    var jupyterPath = path.join(condaInstaller.getInstallationPath(), 'Scripts', 'jupyter-notebook.exe')
                } else {
                    var jupyterPath = path.join(condaInstaller.getInstallationPath(), 'bin', 'jupyter') + ' notebook'
                }
                var notebookCmd = jupyterPath + " --NotebookApp.token=\"" + token + "\" --notebook-dir=\"" + userDataPath + "\" --no-browser --port=" + jupyterPort;
                var childPractice = exec(notebookCmd);
                wrapperPractice(practiceNBURL, childPractice);
            } else {
                loadPracticeNBURL(practiceNBURL, childPractice);
            }
        });
    }

    wrapperPractice = (practiceNBURL, childPractice) => {
        var buffer = '';

        stderrHandlerPractice = (data, cb) => {
            buffer = buffer + data;
            if(buffer.includes('The Jupyter Notebook is running at')) {
                loadPracticeNBURL(practiceNBURL);
                buffer = '';
                childPractice.stderr.removeListener('data', stderrHandlerPractice);
            }
        }

        childPractice.stderr.on('data', stderrHandlerPractice);
    }

    loadPracticeNBURL = (practiceNBURL) => {
        ejse.data('practiceNBURL', practiceNBURL);
        this.mainWindow.loadURL(path.join('file://', __dirname, '../views', 'practiceNB.ejs'));
    }
}

module.exports = Renderer