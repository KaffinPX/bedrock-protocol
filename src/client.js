const fs = require('fs')
const debug = require('debug')('minecraft-protocol')
const auth = require('./client/auth')
const Options = require('./options')
const { Connection } = require('./connection')
const { createDeserializer, createSerializer } = require('./transforms/serializer')
const { Encrypt } = require('./auth/encryption')
const { RakClient } = require('./Rak')
const { serialize } = require('./datatypes/util')

const debugging = false

class Client extends Connection {
  /** @param {{ version: number, hostname: string, port: number }} options */
  constructor(options) {
    super()
    this.options = { ...Options.defaultOptions, ...options }
    this.serializer = createSerializer()
    this.deserializer = createDeserializer()
    this.validateOptions()

    Encrypt(this, null, options)

    if (options.password) {
      auth.authenticatePassword(this, options)
    } else {
      auth.authenticateDeviceCode(this, options)
    }

    this.on('session', this.connect)
    this.startQueue()
    this.inLog = (...args) => console.info('C ->', ...args)
    this.outLog = (...args) => console.info('C <-', ...args)
  }

  validateOptions() {
    if (!this.options.hostname || this.options.port == null) throw Error('Invalid hostname/port')
    if (this.options.version < Options.MIN_VERSION) {
      throw new Error(`Unsupported protocol version < ${Options.MIN_VERSION} : ${this.options.version}`)
    }
  }

  onEncapsulated = (encapsulated, inetAddr) => {
    const buffer = Buffer.from(encapsulated.buffer)
    this.handle(buffer)
  }

  connect = async (sessionData) => {
    const hostname = this.options.hostname
    const port = this.options.port

    this.connection = new RakClient({ useWorkers: true, hostname, port })
    this.connection.onConnected = () => this.sendLogin()
    this.connection.onEncapsulated = this.onEncapsulated
    this.connection.connect()
  }

  sendLogin() {
    this.createClientChain()

    const chain = [
      this.clientIdentityChain, // JWT we generated for auth
      ...this.accessToken // Mojang + Xbox JWT from auth
    ]

    const encodedChain = JSON.stringify({ chain })

    const bodyLength = this.clientUserChain.length + encodedChain.length + 8

    debug('Auth chain', chain)

    this.write('login', {
      protocol_version: this.options.version,
      payload_size: bodyLength,
      chain: encodedChain,
      client_data: this.clientUserChain
    })
    this.emit('loggingIn')
  }

  onDisconnectRequest(packet) {
    // We're talking over UDP, so there is no connection to close, instead
    // we stop communicating with the server
    console.warn(`Server requested ${packet.hide_disconnect_reason ? 'silent disconnect' : 'disconnect'}: ${packet.message}`)
    process.exit(1) // TODO: handle
  }

  close() {
    console.warn('Close not implemented!!')
  }

  tryRencode(name, params, actual) {
    const packet = this.serializer.createPacketBuffer({ name, params })

    console.assert(packet.toString('hex') == actual.toString('hex'))
    if (packet.toString('hex') !== actual.toString('hex')) {

      const ours = packet.toString('hex').match(/.{1,16}/g).join('\n')
      const theirs = actual.toString('hex').match(/.{1,16}/g).join('\n')

      fs.writeFileSync('ours.txt', ours)
      fs.writeFileSync('theirs.txt', theirs)
      fs.writeFileSync('ours.json', serialize(params))
      fs.writeFileSync('theirs.json', serialize(this.deserializer.parsePacketBuffer(packet).data.params))

      throw new Error(name + ' Packet comparison failed!')
    }
  }

  readPacket(packet) {
    const des = this.deserializer.parsePacketBuffer(packet)
    const pakData = { name: des.data.name, params: des.data.params }
    this.inLog('-> C', pakData.name/*, serialize(pakData.params).slice(0, 100)*/)

    if (debugging) {
      // Packet verifying (decode + re-encode + match test)
      if (pakData.name) {
        this.tryRencode(pakData.name, pakData.params, packet)
      }

      // console.info('->', JSON.stringify(pakData, (k,v) => typeof v == 'bigint' ? v.toString() : v))
      // Packet dumping
      try {
        if (!fs.existsSync(`./packets/${pakData.name}.json`)) {
          fs.writeFileSync(`./packets/${pakData.name}.json`, serialize(pakData.params, 2))
          fs.writeFileSync(`./packets/${pakData.name}.txt`, packet.toString('hex'))
        }
      } catch { }
    }

    // Abstract some boilerplate before sending to listeners
    switch (des.data.name) {
      case 'server_to_client_handshake':
        this.emit('client.server_handshake', des.data.params)
        break
      case 'disconnect': // Client kicked
        this.onDisconnectRequest(des.data.params)
        break
      // case 'crafting_data':
      //   fs.writeFileSync('crafting.json', JSON.stringify(des.data.params, (k, v) => typeof v == 'bigint' ? v.toString() : v))
      //   break
      // case 'start_game':
      //   fs.writeFileSync('start_game.json', JSON.stringify(des.data.params, (k, v) => typeof v == 'bigint' ? v.toString() : v))
      //   break
      // case 'level_chunk':
      //   // fs.writeFileSync(`./chunks/chunk-${chunks++}.txt`, packet.toString('hex'))
      //   break
      default:
      // console.log('Sending to listeners')
    }

    // Emit packet
    this.emit(des.data.name, des.data.params)
  }
}

module.exports = { Client }