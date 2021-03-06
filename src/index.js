const {smarthome} = require('actions-on-google');
const {Headers} = require('actions-on-google');
const util = require('util');
const ngrok = require('ngrok');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser')
const mqtt = require('mqtt')
var express = require('express');

let ngrokAux = false;
process.argv.forEach((value) => {
    if (value.includes('isLocal')) {
        ngrokAux = true;
    }
});
// Running server locally using ngrok
var useNgrok = ngrok;
var expressPort = 3000;

var device_status = new Map();

// Client
const SERVER = 'mqtt://localhost'
const TOPIC = 'DeviceStatusRequest'

var client = mqtt.connect(SERVER)

// helper function to log date+text to console:
const log = (text) => {
  console.log(`[${new Date().toLocaleString()}] ${text}`)
}

// on connection event:
client.on(
  'connect',
  (message) => {
    log(`Connected to ${SERVER}`)
    client.subscribe('#')
  }
)

// on message received event:
client.on(
  'message',
  (topic, message) => {
    log(`Message received on topic ${topic}: ${message.toString()}`)
    device_status.set(topic, message)
  }
)


var app = express()
app.use(cors())
app.use(morgan('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))
app.set('trust proxy', 1)

const appGoogle = smarthome({
  debug: true,
})

app.get('/login', (req, res) => {
  console.log("Login Get Petition Received")
  res.send(`
    <html>
      <body>
        <form action="/login" method="post">
          <input type="hidden" name="responseurl" value="${req.query.responseurl}" />
          <button type="submit" style="font-size:14pt">Link this service to Google</button>
        </form>
      </body>
    </html>
  `)
});


app.post('/login', async (req, res) => {
    console.log('Login Post Petition Received')
    // Here, you should validate the user account.
    // In this sample, we do not do that.
    const responseurl = decodeURIComponent(req.body.responseurl)
    console.log(`Redirect to ${responseurl}`)
    return res.redirect(responseurl)
});

app.get('/fakeauth', async (req, res) => {
  console.log('Fakeauth Get Petition Received')
  const responseurl = util.format('%s?code=%s&state=%s',
    decodeURIComponent(req.query.redirect_uri), 'xxxxxx',
    req.query.state)
  console.log(`Set redirect as ${responseurl}`)
  return res.redirect(`/login?responseurl=${encodeURIComponent(responseurl)}`)
});

app.all('/faketoken', async (req, res) => {
  console.log('Faketoken All Petition Received')
  const grantType = req.query.grant_type
    ? req.query.grant_type : req.body.grant_type
  const secondsInDay = 86400 // 60 * 60 * 24
  const HTTP_STATUS_OK = 200
  console.log(`Grant type ${grantType}`)

  let obj
  if (grantType === 'authorization_code') {
    obj = {
      token_type: 'bearer',
      access_token: '123access',
      refresh_token: '123refresh',
      expires_in: secondsInDay,
    }
  } else if (grantType === 'refresh_token') {
    obj = {
      token_type: 'bearer',
      access_token: '123access',
      expires_in: secondsInDay,
    }
  }
  res.status(HTTP_STATUS_OK).json(obj)
});

appGoogle.onSync((body) => {
  console.log("Google - OnSync - enter")
  console.log(body)
  return {
    requestId: body.requestId,
    payload: {
      agentUserId: 'ChavesJM',
      devices: [{
        id: 'LuzSalonID',
        type: 'action.devices.types.LIGHT',
        traits: [
          'action.devices.traits.OnOff',
        ],
        name: {
          defaultNames: ['Luz Salón'],
          name: 'Luz Salón',
          nicknames: ['Luz Salón'],
        },
        deviceInfo: {
          manufacturer: 'ChavesJM CO',
          model: 'Light-Pi',
          hwVersion: '1.0',
          swVersion: '1.0.1',
        },
        willReportState: true,
      }],
    },
  };
});

function updateDevice(execution,deviceId){
  
	const {params,command} = execution;
  	let state, ref;
  	switch (command) {
    		case 'action.devices.commands.OnOff':
      			state = {on: params.on};
			if(params.on === true){
	      			console.log("updateDevice() - Turn ON")
				client.publish(deviceId, '1');
			}
			else{
				console.log("updateDevice() - Turn OFF")
				client.publish(deviceId, '0');
			}
      		break;
    		case 'action.devices.commands.StartStop':
      			state = {isRunning: params.start};
      		break;
    		case 'action.devices.commands.PauseUnpause':
      			state = {isPaused: params.pause};
      		break;
  	}

  	return state;
};



appGoogle.onExecute(async (body) => {
	console.log("Google - OnExecute - enter")
	console.log(body)

	const {requestId} = body;
  	// Execution results are grouped by status
  	const result = {
    		ids: [],
    		status: 'SUCCESS',
    		states: {
      		online: true,
    		},
  	};

  	const executePromises = [];
  	const intent = body.inputs[0];

  	for (const command of intent.payload.commands) {
    		for (const device of command.devices) {
      			for (const execution of command.execution) {
				console.log("Google - OnExecute - Execution: " + execution.command)
				console.log("Google - OnExecute - Device: " + device.id)
				result.ids.push(device.id)
				result.states = updateDevice(execution, device.id)
      }
    }
  }

  return {
    requestId: requestId,
    payload: {
      commands: [result],
    },
  };	
});

function queryDevice(deviceId){
   aux = device_status.has(deviceId)
   enable = aux ? device_status[deviceId]:0
   isOnline = aux ? true:false
   return {
     on: enable == 0 ? false:true,
     online: isOnline,
   };
}

appGoogle.onQuery(async (body) => {
	console.log("Google - OnQuery - enter")
	console.log(body)

	const {requestId} = body;	
  	const {devices} = body.inputs[0].payload
	const payload = {
                devices: {},
        };
	for (const device of devices){
		console.log("Google - OnQuery - DeviceId: " + device.id)
		payload.devices[device.id] = queryDevice(device.id);		
	}

	console.log("Google - OnQuery - Payload: " + payload)
	return {
    		requestId: requestId,
    		payload: payload,
  	};
});

app.post('/smarthome', appGoogle)

app.post('/smarthome/update', async (req, res) => {
  console.log("Update Post Petition")
  console.log(req)
  res.status(200).send('OK')
})

app.post('/smarthome/create', async (req, res) => {
  console.log("Create Post Petition")
  console.log(req)
  res.status(200).send('OK')
})

app.post('/smarthome/delete', async (req, res) => {
  console.log("Delete Post Petition")
  console.log(req)
  res.status(200).send('OK')
})


app.get('/', function (req, res) {
  res.send('Hello World!');
});


const expressServer = app.listen(3000, async function () {
  console.log('Example app listening on port 3000!');

  const server = expressServer.address();
  const {address, port} = server

  console.log(`Smart home server listening at ${address}:${port}`)

   if (useNgrok) {
    try {
      const url = await ngrok.connect(expressPort)
      console.log('')
      console.log('COPY & PASTE NGROK URL BELOW')
      console.log(url)
      console.log('')
      console.log('=====')
      console.log('Visit the Actions on Google console at http://console.actions.google.com')
      console.log('Replace the webhook URL in the Actions section with:')
      console.log('    ' + url + '/smarthome')

      console.log('')
      console.log('In the console, set the Authorization URL to:')
      console.log('    ' + url + '/fakeauth')

      console.log('')
      console.log('Then set the Token URL to:')
      console.log('    ' + url + '/faketoken')
      console.log('')

      console.log('Finally press the \'TEST DRAFT\' button')
    } catch (err) {
      console.error('Ngrok was unable to start')
      console.error(err)
      process.exit()
    }
  }  

});


