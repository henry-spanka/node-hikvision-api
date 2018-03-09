const net = require('net');
const events = require('events');
const request = require('request');
// const NetKeepAlive = require('net-keepalive');
const xml2js = require('xml2js');

const parser = new xml2js.Parser();

class Hikvision extends events.EventEmitter {
    
    constructor(options) {
        super();

        this.options = options;
        this.baseURI = 'http://' + options.host + ':' + options.port;
        this.activeEvents = {};
        this.triggerActive = false;
        this.logToConsole = options.log;

        this.connect();
    }

    connect() {
        const authHeader = 'Authorization: Basic ' + new Buffer(this.options.user + ':' + this.options.pass).toString('base64');
        // Connect
        const client = net.connect(this.options, () => {
            const header = 'GET /ISAPI/Event/notification/alertStream HTTP/1.1\r\n' +
                'Host: ' + this.options.host + ':' + this.options.port + '\r\n' +
                authHeader + '\r\n' +
                'Accept: multipart/x-mixed-replace\r\n\r\n';
            client.write(header);
            client.setKeepAlive(true, 1000);

            // NetKeepAlive.setKeepAliveInterval(client, 5000);	// sets TCP_KEEPINTVL to 5s
            // NetKeepAlive.setKeepAliveProbes(client, 12);	// 60s and kill the connection.

            this.handleConnection(this.options);
        });

        client.on('data', this.handleData.bind(this));

        client.on('close', () => {		// Try to reconnect after 30s
            setTimeout(() => this.connect(this.options), 30000);
            this.handleEnd();
        });

        client.on('error', this.handleError.bind(this));
    }

    ptzCommand(cmd, arg1, arg2, arg3, arg4) {
        if ((!cmd) || (isNaN(arg1)) || (isNaN(arg2)) || (isNaN(arg3)) || (isNaN(arg4))) {
            this.handleError(this, 'INVALID PTZ COMMAND');
            return 0
        }
        request(this.baseURI + '/cgi-bin/ptz.cgi?action=start&channel=0&code=' + cmd + '&arg1=' + arg1 + '&arg2=' + arg2 + '&arg3=' + arg3 + '&arg4=' + arg4, (error, response, body) => {
            if ((error) || (response.statusCode !== 200) || (body.trim() !== 'OK')) {
                this.emit('error', 'FAILED TO ISSUE PTZ COMMAND');
            }
        })
    }

    ptzPreset(preset) {
        if (isNaN(preset)) {
            this.handleError('INVALID PTZ PRESET');
        }
        request(this.baseURI + '/cgi-bin/ptz.cgi?action=start&channel=0&code=GotoPreset&arg1=0&arg2=' + preset + '&arg3=0', (error, response, body) => {
            if ((error) || (response.statusCode !== 200) || (body.trim() !== 'OK')) {
                this.emit('error', 'FAILED TO ISSUE PTZ PRESET');
            }
        })
    }

    ptzZoom(multiple) {
        if (isNaN(multiple)) {
            this.handleError(this, 'INVALID PTZ ZOOM');
        }

        if (multiple === 0) {
            return 0;
        }

        let cmd;
        if (multiple > 0) {
            cmd = 'ZoomTele';
        }
        if (multiple < 0) {
            cmd = 'ZoomWide';
        }

        request(this.baseURI + '/cgi-bin/ptz.cgi?action=start&channel=0&code=' + cmd + '&arg1=0&arg2=' + multiple + '&arg3=0', (error, response, body) => {
            if ((error) || (response.statusCode !== 200) || (body.trim() !== 'OK')) {
                if (this.logToConsole) {
                    console.log('FAILED TO ISSUE PTZ ZOOM');
                }
                this.emit('error', 'FAILED TO ISSUE PTZ ZOOM');
            }
        })
    }

    ptzMove(direction, action, speed) {
        if (isNaN(speed)) {
            this.handleError(this, 'INVALID PTZ SPEED');
        }
        if ((action !== 'start') || (action !== 'stop')) {
            this.handleError(this, 'INVALID PTZ COMMAND');
            return 0;
        }
        if ((direction !== 'Up') || (direction !== 'Down') || (direction !== 'Left') || (direction !== 'Right')
            (direction !== 'LeftUp') || (direction !== 'RightUp') || (direction !== 'LeftDown') || (direction !== 'RightDown')) {
            this.emit('error', 'INVALID PTZ DIRECTION: ' + direction);
            if (this.logToConsole) {
                console.log('INVALID PTZ DIRECTION: ' + direction);
            }
            return 0;
        }
        request(this.baseURI + '/cgi-bin/ptz.cgi?action=' + action + '&channel=0&code=' + direction + '&arg1=' + speed + '&arg2=' + speed + '&arg3=0', (error, response, body) => {
            if ((error) || (response.statusCode !== 200) || (body.trim() !== 'OK')) {
                this.emit('error', 'FAILED TO ISSUE PTZ UP COMMAND');
                if (this.logToConsole) console.log('FAILED TO ISSUE PTZ UP COMMAND');
            }
        })
    }

    ptzStatus() {
        request(this.baseURI + '/cgi-bin/ptz.cgi?action=getStatus', (error, response, body) => {
            if ((!error) && (response.statusCode === 200)) {
                body = body.toString().split('\r\n').trim();
                if (this.logToConsole) {
                    console.log('PTZ STATUS: ' + body);
                }
                this.emit('ptzStatus', body);
            } else {
                this.emit('error', 'FAILED TO QUERY STATUS');
                if (this.logToConsole) {
                    console.log('FAILED TO QUERY STATUS');
                }
            }
        })
    }

    dayProfile() {
        request(this.baseURI + '/cgi-bin/configManager.cgi?action=setConfig&VideoInMode[0].Config[0]=1', (error, response, body) => {
            if ((!error) && (response.statusCode === 200)) {
                if (body === 'Error') {		// Didnt work, lets try another method for older cameras
                    request(this.baseURI + '/cgi-bin/configManager.cgi?action=setConfig&VideoInOptions[0].NightOptions.SwitchMode=0', (error, response) => {
                        if ((error) || (response.statusCode !== 200)) {
                            this.emit('error', 'FAILED TO CHANGE TO DAY PROFILE');
                            if (this.logToConsole) {
                                console.log('FAILED TO CHANGE TO DAY PROFILE');
                            }
                        }
                    })
                }
            } else {
                this.emit('error', 'FAILED TO CHANGE TO DAY PROFILE');
                if (this.logToConsole) {
                    console.log('FAILED TO CHANGE TO DAY PROFILE');
                }
            }
        })
    }

    nightProfile() {
        request(this.baseURI + '/cgi-bin/configManager.cgi?action=setConfig&VideoInMode[0].Config[0]=2', (error, response, body) => {
            if ((!error) && (response.statusCode === 200)) {
                if (body === 'Error') {		// Didnt work, lets try another method for older cameras
                    request(this.baseURI + '/cgi-bin/configManager.cgi?action=setConfig&VideoInOptions[0].NightOptions.SwitchMode=3', (error, response) => {
                        if ((error) || (response.statusCode !== 200)) {
                            this.emit('error', 'FAILED TO CHANGE TO NIGHT PROFILE');
                            if (this.logToConsole) {
                                console.log('FAILED TO CHANGE TO NIGHT PROFILE');
                            }
                        }
                    })
                }
            } else {
                this.emit('error', 'FAILED TO CHANGE TO NIGHT PROFILE');
                if (this.logToConsole) {
                    console.log('FAILED TO CHANGE TO NIGHT PROFILE');
                }
            }
        })
    }

    // Handle alarms
    handleData(data) {
        parser.parseString(data, (err, result) => {
            if (result) {
                let code = result['EventNotificationAlert']['eventType'][0];
                let action = result['EventNotificationAlert']['eventState'][0];
                const index = parseInt(result['EventNotificationAlert']['channelID'][0]);
                const count = parseInt(result['EventNotificationAlert']['activePostCount'][0]);

                // give codes returned by camera prettier and standardized description
                if (code === 'IO') code = 'AlarmLocal';
                if (code === 'VMD') code = 'VideoMotion';
                if (code === 'linedetection') code = 'LineDetection';
                if (code === 'videoloss') code = 'VideoLoss';
                if (code === 'shelteralarm') code = 'VideoBlind';
                if (action === 'active') action = 'Start';
                if (action === 'inactive') action = 'Stop';

                // create and event identifier for each recieved event
                // This allows multiple detection types with multiple indexes for DVR or multihead devices
                const eventIdentifier = code + index;

                // Count 0 seems to indicate everything is fine and nothing is wrong, used as a heartbeat
                // if triggerActive is true, lets step through the activeEvents
                // If activeEvents has something, lets end those events and clear activeEvents and reset triggerActive
                if (count === 0) {
                    if (this.triggerActive === true) {
                        for (let i in this.activeEvents) {
                            if (this.activeEvents.hasOwnProperty(i)) {
                                let eventDetails = this.activeEvents[i];
                                if (this.logToConsole) {
                                    console.log('Ending Event: ' + i + ' - ' + eventDetails['code'] + ' - ' + ((Date.now() - eventDetails['lasttimestamp']) / 1000));
                                }
                                this.emit('alarm', eventDetails['code'], 'Stop', eventDetails['index']);
                            }
                        }
                        this.activeEvents = {};
                        this.triggerActive = false;

                    } else {
                        // should be the most common result
                        // Nothing interesting happening and we haven't seen any events
                        if (this.logToConsole) {
                            this.emit('alarm', code, action, index);
                        }
                    }
                }

                // if the first instance of an eventIdentifier, lets emit it,
                // add to activeEvents and set triggerActive
                else if (this.activeEvents[eventIdentifier] === undefined || this.activeEvents[eventIdentifier] === null) {
                    const eventDetails = {};
                    eventDetails['code'] = code;
                    eventDetails['index'] = index;
                    eventDetails['lasttimestamp'] = Date.now();

                    this.activeEvents[eventIdentifier] = eventDetails;
                    this.emit('alarm', code, action, index);
                    this.triggerActive = true

                    // known active events
                } else {
                    if (this.logToConsole) {
                        console.log('    Skipped Event: ' + code + ' ' + action + ' ' + index + ' ' + count);
                    }

                    // Update lasttimestamp
                    const eventDetails = {};
                    eventDetails['code'] = code;
                    eventDetails['index'] = index;
                    eventDetails['lasttimestamp'] = Date.now();
                    this.activeEvents[eventIdentifier] = eventDetails;

                    // step through activeEvents
                    // if we haven't seen it in more than 2 seconds, lets end it and remove from activeEvents
                    for (let i in this.activeEvents) {
                        if (this.activeEvents.hasOwnProperty(i)) {
                            const eventDetails = this.activeEvents[i];
                            if (((Date.now() - eventDetails['lasttimestamp']) / 1000) > 2) {
                                if (this.logToConsole) console.log('    Ending Event: ' + i + ' - ' + eventDetails['code'] + ' - ' + ((Date.now() - eventDetails['lasttimestamp']) / 1000));
                                this.emit('alarm', eventDetails['code'], 'Stop', eventDetails['index']);
                                delete this.activeEvents[i]
                            }
                        }
                    }
                }
            }
        });
    }

    handleConnection(options) {
        if (this.logToConsole) {
            console.log('Connected to ' + options.host + ':' + options.port);
        }
        //this.socket = socket;
        this.emit('connect');
    }

    handleEnd() {
        if (this.logToConsole) {
            console.log('Connection closed!');
        }
        this.emit('end');
    }

    handleError(err) {
        if (this.logToConsole) {
            console.log('Connection error: ' + err);
        }
        this.emit('error', err);
    }
}

module.exports = Hikvision;