
# Raft Node Presence Manager

A Node.js implementation for managing node presence in a distributed system using the Raft consensus algorithm and MQTT protocol.

## Features

- Manages node presence and active nodes in a distributed network using the MQTT protocol.
- Implements the Raft consensus protocol for leader election and state management.
- Provides easy-to-use methods to handle MQTT connections, subscriptions, and messaging.

## Installation

Install the package via npm:

```bash
npm install node-raft-over-mqtt
```

## Libraries Used

This project makes use of the following libraries:

- **[node-mqtt-client](https://github.com/ubyte-source/node-mqtt-client):** MQTT client for managing secure MQTT connections with certificate-based authentication.

## Usage

Here's an example of how to use the `NodePresenceManager` and `RaftNode` classes:

### Initialization

To set up the Raft node, create an instance and set the required properties.

```javascript
const { MQTTClient, RaftNode } = require('node-raft-over-mqtt');

// Configure the MQTT client
const mqttClient = new MQTTClient();
mqttClient.host = 'broker.fabris.io';
mqttClient.port = 8883;
mqttClient.protocol = MQTTClient.Protocol.MQTTS;
mqttClient.certificateManager.loadCertificates(
  'authority.pem',
  'certificate.pem',
  'key.pem'
);
mqttClient.connect();

// Unique identifier for the node
const uuid = 'node-1';

// Initialize the Raft node
const raftNode = RaftNode.initialize(mqttClient, uuid);

// Set the logging function
raftNode.logFunction = console.log;

// Start the node
raftNode.start();
```

### MQTT Client Configuration

For detailed configuration options and parameters for the `MQTTClient`, please refer to the official [node-mqtt-client](https://github.com/ubyte-source/node-mqtt-client) documentation.

### Configuration Parameters for RaftNode

| Parameter             | Type       | Description                                                         | Default        |
|-----------------------|------------|---------------------------------------------------------------------|----------------|
| `electionTimeout`     | `number`   | The timeout duration in milliseconds for the election process.      | `8000`         |
| `heartbeatInterval`   | `number`   | The interval in milliseconds between heartbeats sent by the leader. | `2000`         |
| `metricFunction`      | `Function` | The function used to calculate the node's metric for elections.      | `() => 1e6` |

#### RaftNode Public Variables

##### `presenceManager` (Read-only)

Returns the instance of the `NodePresenceManager` associated with the node.

**Returns:**  
`NodePresenceManager` - The presence manager instance.

##### `logFunction`

Gets or sets the log function.

- **Get:** Returns the current log function.
  - **Returns:** `Function` - The log function.
- **Set:** Sets a new log function for logging messages.
  - **Parameters:** `func` (`Function`): The new log function.

##### `leaderMetric` (Read-only)

Gets the leader's metric value.

**Returns:**  
`number` - The current leader metric.

#### RaftNode Public Methods

##### `initialize(mqttClient, uuid)`

Initializes a new RaftNode instance if it does not exist.

- `mqttClient` (`MQTTClient`): The MQTT client instance.
- `uuid` (`string`): The unique identifier for the node.

**Returns:**  
`RaftNode` - The instance of the RaftNode.

##### `log(message)`

Logs a message using the provided log function.

- `message` (`string`): The message to log.

##### `start()`

Starts the Raft node and initializes its state.

##### `isLeader()`

Checks if the current node is the leader.

**Returns:**  
`boolean` - `true` if the node is a leader, otherwise `false`.

## Versioning

We use [SemVer](https://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/ubyte-source/certificate-authority/tags). 

## Authors

* **Paolo Fabris** - *Initial work* - [ubyte.it](https://ubyte.it/)

See also the list of [contributors](https://github.com/ubyte-source/certificate-authority/blob/main/CONTRIBUTORS.md) who participated in this project.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/ubyte-source/node-raft-over-mqtt/blob/main/LICENSE) file for details.
