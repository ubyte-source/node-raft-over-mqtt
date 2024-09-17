'use strict';

const { MQTTClient } = require('node-mqtt-client');

/**
 * Class representing a Node Presence Manager to handle node presence in a distributed system.
 */
class NodePresenceManager {
    static PRESENCE = 'raft/presence';

    #activeNodes;
    #presence;
    #presenceInterval;
    #raftNode;
    #mqttClient;
    #uuid;
    #log;

    /**
     * Constructor for NodePresenceManager.
     * @param {Object} raftNode - The raft node instance.
     * @param {MQTTClient} mqttClient - An instance of MQTTClient.
     * @param {string} uuid - Unique identifier for this node.
     * @param {Function} logFunction - Function for logging messages.
     * @throws {Error} If mqttClient is not an instance of MQTTClient.
     */
    constructor(raftNode, mqttClient, uuid, logFunction) {
        if (false === (mqttClient instanceof MQTTClient))
            throw new Error('The mqttClient parameter must be an instance of MQTTClient.');

        this.#uuid = uuid;
        this.#mqttClient = mqttClient;
        this.#raftNode = raftNode;
        this.#activeNodes = new Map();
        this.#presence = null;
        this.#presenceInterval = 3000;
        this.#log = logFunction;

        const options = {
            qos: 1,
            retain: false,
            nl: false
        };

        this.#mqttClient.onMessage((topic, message) => this.#handleMessage(topic, message));
        this.#mqttClient.subscribe(NodePresenceManager.PRESENCE, options, (error) => {
            if (error) return this.log('Failed to subscribe to presence topic.');
        });
    }

    /**
     * Gets the current raft node.
     * @returns {Object} The raft node instance.
     */
    get raftNode() {
        return this.#raftNode;
    }

    /**
     * Gets the presence interval in milliseconds.
     * @returns {number} The current presence interval.
     */
    get presenceInterval() {
        return this.#presenceInterval;
    }

    /**
     * Sets the presence interval in milliseconds.
     * @param {number} value - The new presence interval value.
     * @throws {Error} If the provided value is not a positive number.
     * @returns {NodePresenceManager} The instance of the NodePresenceManager for chaining.
     */
    set presenceInterval(value) {
        if (typeof value !== 'number'
            || value <= 0) throw new Error('Invalid value for presenceInterval. It must be a positive number.');

        this.#presenceInterval = value;
        this.#log(`Presence interval updated to: ${value} ms`);
        return this;
    }

    /**
     * Gets the count of currently active nodes.
     * @returns {number} The number of active nodes.
     */
    getActiveNodesCount() {
        return this.#activeNodes.size;
    }

    /**
     * Starts publishing the presence of this node at regular intervals.
     */
    startPresencePublishing() {
        this.#stopPresencePublishing();
        this.#presence = setInterval(() => this.#publishPresence(), this.#presenceInterval);
        this.#log('Start presence publishing.');
    }

    /**
     * Stops publishing the presence of this node.
     * @private
     */
    #stopPresencePublishing() {
        if (this.#presence === null) return;
        clearInterval(this.#presence);
        this.#presence = null;
        this.#log('Stopped presence publishing.');
    }

    /**
     * Publishes the presence of this node to the MQTT broker.
     * @private
     */
    #publishPresence() {
        const uuid = this.#uuid.toString();
        const options = {
            qos: 1,
            retain: false
        };
        this.#mqttClient.publish(NodePresenceManager.PRESENCE, uuid, options, (err) => {
            if (err) this.#log('Error publishing presence:', err);
        });
        this.#cleanupActiveNodes();
    }

    /**
     * Handles a new presence message from another node.
     * @param {string} senderId - The unique identifier of the sender node.
     * @private
     */
    #handleNodePresence(senderId) {
        this.#activeNodes.set(senderId, Date.now());
        this.#log(`Active node detected: ${senderId}. Total active nodes: ${this.#activeNodes.size}`);
    }

    /**
     * Cleans up nodes that have not sent presence messages recently.
     * @private
     */
    #cleanupActiveNodes() {
        const now = Date.now();
        const timeout = 3 * this.#presenceInterval;
        for (const [nodeId, lastSeen] of this.#activeNodes) {
            if (now - lastSeen <= timeout) continue;
            this.#activeNodes.delete(nodeId);
            this.#log(`Inactive node detected and removed: ${nodeId}`);
        }
    }

    /**
     * Handles incoming MQTT messages for presence management.
     * @param {string} topic - The topic of the received message.
     * @param {Buffer} message - The received message payload.
     * @private
     */
    #handleMessage(topic, message) {
        if (false === topic.includes(NodePresenceManager.PRESENCE)) return;
        const senderId = message.toString();
        this.#handleNodePresence(senderId);
    }
}

class RaftNode {
    static #instance;
    static TOPICS = {
        ELECTION: 'raft/election',
        HEARTBEAT: 'raft/heartbeat',
        VOTE: 'raft/vote'
    };
    static STATES = {
        FOLLOWER: 'follower',
        CANDIDATE: 'candidate',
        LEADER: 'leader'
    };

    #uuid;
    #mqttClient;
    #state;
    #currentTerm;
    #votedFor;
    #votesReceived;
    #electionTimeout;
    #heartbeatInterval;
    #heartbeatTimer;
    #electionTimer;
    #presenceManager;
    #logFunction;
    #leaderMetric;
    #metric;

    /**
     * Constructor for RaftNode.
     * @param {MQTTClient} mqttClient - An instance of MQTTClient.
     * @param {string} uuid - Unique identifier for this node.
     * @throws {Error} If RaftNode instance already exists or mqttClient is not an instance of MQTTClient.
     */
    constructor(mqttClient, uuid) {
        if (RaftNode.#instance instanceof RaftNode)
            throw new Error('Instance RaftNode already exists!');
        if (false === (mqttClient instanceof MQTTClient))
            throw new Error('The mqttClient parameter must be an instance of MQTTClient.');

        this.#uuid = uuid.toString();
        this.#mqttClient = mqttClient;
        this.#state = RaftNode.STATES.FOLLOWER;
        this.#currentTerm = 0;
        this.#votedFor = null;
        this.#votesReceived = 0;
        this.#electionTimeout = 8000;
        this.#heartbeatInterval = 2000;
        this.#leaderMetric = null;
        this.#presenceManager = new NodePresenceManager(this, mqttClient, uuid, (msg) => this.log(msg));
        this.#metric = 1e6;

        const options = {
            qos: 1,
            retain: false,
            nl: true
        };

        this.#mqttClient.subscribe(RaftNode.TOPICS.ELECTION, options, (error) => {
            if (error) throw new Error('Failed to subscribe to election topic.');
        });
        this.#mqttClient.subscribe(RaftNode.TOPICS.HEARTBEAT, options, (error) => {
            if (error) throw new Error('Failed to subscribe to heartbeat topic.');
        });
        this.#mqttClient.subscribe(RaftNode.TOPICS.VOTE, options, (error) => {
            if (error) throw new Error('Failed to subscribe to vote topic.');
        });

        this.#mqttClient.onMessage((topic, message) => this.#handleMessage(topic, message));
    }

    /**
     * Gets the presence manager associated with the node.
     * @returns {NodePresenceManager} The presence manager instance.
     */
    get presenceManager() {
        return this.#presenceManager;
    }

    /**
     * Gets the election timeout interval.
     * @returns {number} The election timeout in milliseconds.
     */
    get electionTimeout() {
        return this.#electionTimeout;
    }

    /**
     * Sets the election timeout interval.
     * @param {number} value - The new election timeout value.
     * @throws {Error} If the provided value is not a positive number.
     */
    set electionTimeout(value) {
        if (typeof value !== 'number'
            || value <= 0) throw new Error('Invalid value for electionTimeout. It must be a positive number.');

        this.#electionTimeout = value;
        this.log(`Election timeout updated to: ${value} ms`);
    }

    /**
     * Gets the heartbeat interval.
     * @returns {number} The heartbeat interval in milliseconds.
     */
    get heartbeatInterval() {
        return this.#heartbeatInterval;
    }

    /**
     * Sets the heartbeat interval.
     * @param {number} value - The new heartbeat interval value.
     * @throws {Error} If the provided value is not a positive number.
     */
    set heartbeatInterval(value) {
        if (typeof value !== 'number'
            || value <= 0) throw new Error('Invalid value for heartbeatInterval. It must be a positive number.');

        this.#heartbeatInterval = value;
        this.log(`Heartbeat interval updated to: ${value} ms`);
    }

    /**
     * Gets the log function.
     * @returns {Function} The current log function.
     */
    get logFunction() {
        return this.#logFunction;
    }

    /**
     * Sets the log function.
     * @param {Function} func - The new log function.
     * @throws {Error} If the provided value is not a function.
     */
    set logFunction(func) {
        if (typeof func !== 'function')
            throw new Error('Invalid log function. It must be a function.');

        this.#logFunction = func;
        this.log('Log function updated.');
    }

    /**
     * Gets the leader's metric value.
     * @returns {number} The current leader metric.
     */
    get leaderMetric() {
        return this.#leaderMetric;
    }

    /**
     * Initializes a new RaftNode instance if it does not exist.
     * @param {MQTTClient} mqttClient - An instance of MQTTClient.
     * @param {string} uuid - Unique identifier for this node.
     * @returns {RaftNode} The instance of the RaftNode.
     */
    static initialize(mqttClient, uuid) {
        if (false === (RaftNode.#instance instanceof RaftNode))
            RaftNode.#instance = new RaftNode(mqttClient, uuid);
        return RaftNode.#instance;
    }

    /**
     * Gets the current metric value.
     * @returns {number} The metric value.
     */
    get metric() {
        return this.#metric;
    }

    /**
     * Sets the metric value.
     * @param {number} value - The new metric value.
     * @throws {Error} If the value is not a number.
     */
    set metric(value) {
        if (typeof value !== 'number') {
            throw new Error('Invalid metric value. It must be a number.');
        }
        this.#metric = value;
        this.log(`Metric value updated with ${value}.`);
    }

    /**
     * Logs a message using the log function.
     * @param {string} message - The message to log.
     */
    log(message) {
        if (typeof this.#logFunction !== 'function') return;
        this.#logFunction(message);
    }

    /**
     * Starts the raft node and initializes its state.
     */
    start() {
        this.log('Node started as follower.');
        this.#presenceManager.startPresencePublishing();
        this.#restartElectionTimeout();
    }

    /**
     * Checks if the current node is the leader.
     * @returns {boolean} True if the node is a leader, otherwise false.
     */
    isLeader() {
        return this.#state === RaftNode.STATES.LEADER;
    }

    /**
     * Handles incoming MQTT messages and processes them based on their topic.
     * @param {string} topic - The topic of the received message.
     * @param {Buffer} message - The received message payload.
     * @private
     */
    #handleMessage(topic, message) {
        const [term, senderId, data] = message.toString().split(String.fromCharCode(58));
        const parsedTerm = parseInt(term, 10);

        if (typeof senderId !== 'string' || this.#uuid === senderId) return;
        if (parsedTerm < this.#currentTerm) return this.log(`Node ${this.#uuid} rejects request with outdated term.`);
        if (parsedTerm > this.#currentTerm) this.#handleHigherTerm(term);

        switch (true) {
            case topic.includes(RaftNode.TOPICS.ELECTION):
                this.#handleElectionRequest(senderId, parsedTerm, parseFloat(data));
                break;
            case topic.includes(RaftNode.TOPICS.HEARTBEAT):
                this.#handleHeartbeat(senderId, parsedTerm, parseFloat(data));
                break;
            case topic.includes(RaftNode.TOPICS.VOTE):
                this.#handleVoteResponse(senderId, data);
                break;
        }
    }

    /**
     * Handles cases where a higher term number is detected in an incoming message.
     * @param {number} term - The new term number detected.
     * @private
     */
    #handleHigherTerm(term) {
        this.#votedFor = null;
        this.#currentTerm = term;
        this.#resetNodeState(RaftNode.STATES.FOLLOWER);
        this.log(`Detected higher term (${term}), switching to follower.`);
        this.#restartElectionTimeout();
    }

    /**
     * Processes an election request from a candidate node.
     * @param {string} candidateId - The ID of the candidate node requesting a vote.
     * @param {number} term - The term number associated with the election request.
     * @param {number} candidateMetric - The metric value of the candidate node.
     * @private
     */
    #handleElectionRequest(candidateId, term, candidateMetric) {
        if (term === this.#currentTerm && this.#votedFor !== null && this.#votedFor !== candidateId)
            return this.log(`Node ${this.#uuid} rejects vote for ${candidateId}; already voted for ${this.#votedFor}.`);

        const currentMetric = this.#metric;
        if (candidateMetric > currentMetric
            || (candidateMetric === currentMetric && candidateId > this.#uuid)) this.log(`Node ${this.#uuid} rejects vote for ${candidateId} due to better metric.`);

        const vote = `${term}:${this.#uuid}:${candidateId}`;
        const options = {
            qos: 1,
            retain: false
        };
        this.#votedFor = candidateId;
        this.log(`Voted for candidate ${candidateId} with metric ${candidateMetric}.`);
        this.#mqttClient.publish(RaftNode.TOPICS.VOTE, vote, options, (err) => {
            if (err) this.log(`Error publishing vote: ${vote}`);
        });
        this.#restartElectionTimeout();
    }

    /**
     * Handles a heartbeat message from the leader node.
     * @param {string} leaderId - The ID of the leader node.
     * @param {number} term - The term number associated with the heartbeat.
     * @param {number} leaderMetric - The metric value of the leader node.
     * @private
     */
    #handleHeartbeat(leaderId, term, leaderMetric) {
        this.#leaderMetric = leaderMetric;
        this.log(`Heartbeat received from leader ${leaderId} for term ${term}.`);

        const currentMetric = this.#metric;
        if (this.#state === RaftNode.STATES.LEADER && currentMetric <= leaderMetric)
            return this.log('Received heartbeat from another leader, but current metric is lower or equal. Staying leader.');

        if (leaderMetric <= currentMetric) {
            this.log('Leader\'s metric is better or equal (lower is better). Staying follower.');
            if (this.#state !== RaftNode.STATES.FOLLOWER) this.#resetNodeState(RaftNode.STATES.FOLLOWER);
            this.#restartElectionTimeout();
        } else {
            this.log(`Leader's metric is worse. Current metric: ${currentMetric}, Leader's metric: ${leaderMetric}. Considering state change.`);
            this.#candidateLeadership();
        }
    }

    /**
     * Handles a vote response message from another node.
     * @param {string} senderId - The ID of the node that sent the vote response.
     * @param {string} voteFor - The ID of the node that the vote is for.
     * @private
     */
    #handleVoteResponse(senderId, voteFor) {
        if (this.#state !== RaftNode.STATES.CANDIDATE || this.#uuid !== voteFor)
            return this.log(`Node ${this.#uuid} received a vote for ${voteFor}, but is not a candidate or the vote is not for this node.`);
    
        this.#votesReceived++;
        this.log(`Vote received from ${senderId}. Total votes ${this.#votesReceived}`);
    
        const totalNodes = this.#presenceManager.getActiveNodesCount();
        const totalNodesMajority = 1 + Math.floor(totalNodes / 2);
        if (this.#votesReceived < totalNodesMajority)
            return this.log('Waiting for more votes to be elected as leader.');

        this.log('Majority of votes received. Becoming leader.');
        this.#becomeLeader();
    }

    /**
     * Handles an election timeout event.
     * @private
     */
    #handleElectionTimeout() {
        if (this.#state === RaftNode.STATES.LEADER) return;
        this.log('Election timeout expired. Becoming candidate.');
        if (1 === this.#presenceManager.getActiveNodesCount()) {
            this.log('Only one node active. Becoming leader.');
            this.#becomeLeader();
        } else {
            this.#candidateLeadership();
        }
    }

    /**
     * Initiates the process to become a candidate for leadership.
     * @private
     */
    #candidateLeadership() {
        this.#resetNodeState(RaftNode.STATES.CANDIDATE);
        this.#currentTerm++;
        this.#votedFor = this.#uuid;
        this.#votesReceived = 1;
        this.log('Becoming candidate for election...');
        this.#requestVotes();
        this.#restartElectionTimeout();
    }

    /**
     * Transitions the node to the leader state.
     * @private
     */
    #becomeLeader() {
        this.#resetNodeState(RaftNode.STATES.LEADER);
        this.#startHeartbeat();
    }

    /**
     * Sends a request for votes to other nodes.
     * @private
     */
    #requestVotes() {
        const requesting = `${this.#currentTerm}:${this.#uuid}:${this.#metric}`;
        const options = {
            qos: 1,
            retain: false
        };
        this.log('Vote request sent to other nodes.');
        this.#mqttClient.publish(RaftNode.TOPICS.ELECTION, requesting, options, (err) => {
            if (err) this.log(`Error requesting vote: ${requesting}`);
        });
    }

    /**
     * Restarts the election timeout timer.
     * @private
     */
    #restartElectionTimeout() {
        this.#stopElection();
        const electionTimeoutRandom = this.#electionTimeout + Math.floor(Math.random() * this.#heartbeatInterval * 2);
        this.#electionTimer = setTimeout(() => this.#handleElectionTimeout(), electionTimeoutRandom);
        this.log(`Election timer restarted with timeout: ${electionTimeoutRandom} ms`);
    }

    /**
     * Stops the election timer.
     * @private
     */
    #stopElection() {
        if (this.#electionTimer === null) return;
        clearTimeout(this.#electionTimer);
        this.#electionTimer = null;
        this.log('Election timer stopped.');
    }

    /**
     * Starts the heartbeat timer for sending heartbeats.
     * @private
     */
    #startHeartbeat() {
        this.#stopHeartbeat();
        this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), this.#heartbeatInterval);
        this.log('Heartbeat timer started.');
    }

    /**
     * Sends a heartbeat message to other nodes.
     * @private
     */
    #sendHeartbeat() {
        if (this.#state !== RaftNode.STATES.LEADER) return;
        this.log('Sending heartbeat...');
        const heartbeat = `${this.#currentTerm}:${this.#uuid}:${this.#metric}`;
        const options = {
            qos: 1,
            retain: false
        };
        this.#mqttClient.publish(RaftNode.TOPICS.HEARTBEAT, heartbeat, options, (err) => {
            if (err) this.log(`Error sending heartbeat: ${heartbeat}`);
        });
    }

    /**
     * Stops the heartbeat timer.
     * @private
     */
    #stopHeartbeat() {
        if (this.#heartbeatTimer === null) return;
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
        this.log('Heartbeat timer stopped.');
    }

    /**
     * Resets the state of the node.
     * @param {string} state - The new state of the node.
     * @private
     */
    #resetNodeState(state) {
        this.#state = state;
        this.#stopHeartbeat();
        this.log(`Node ${this.#uuid} state reset to ${state}.`);
    }
}

module.exports = {
    MQTTClient,
    RaftNode
};
