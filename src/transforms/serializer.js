const { ProtoDefCompiler, CompiledProtodef } = require('protodef').Compiler
const { FullPacketParser, Serializer } = require('protodef')
const { join } = require('path')

// Compiles the ProtoDef schema at runtime
function createProtocol (version) {
  const protocol = require(join(__dirname, `../../data/${version}/protocol.json`)).types
  const compiler = new ProtoDefCompiler()
  compiler.addTypesToCompile(protocol)
  compiler.addTypes(require(join(__dirname, '../datatypes/compiler-minecraft')))
  compiler.addTypes(require('prismarine-nbt/compiler-zigzag'))

  const compiledProto = compiler.compileProtoDefSync()
  return compiledProto
}

// Loads already generated read/write/sizeof code
function getProtocol (version) {
  const compiler = new ProtoDefCompiler()
  compiler.addTypes(require(join(__dirname, '../datatypes/compiler-minecraft')))
  compiler.addTypes(require('prismarine-nbt/compiler-zigzag'))

  const compile = (compiler, file) => {
    global.native = compiler.native // eslint-disable-line
    const { PartialReadError } = require('protodef/src/utils') // eslint-disable-line
    return require(file)() // eslint-disable-line
  }

  return new CompiledProtodef(
    compile(compiler.sizeOfCompiler, join(__dirname, `../../data/${version}/size.js`)),
    compile(compiler.writeCompiler, join(__dirname, `../../data/${version}/write.js`)),
    compile(compiler.readCompiler, join(__dirname, `../../data/${version}/read.js`))
  )
}

function createSerializer (version) {
  const proto = getProtocol(version)
  return new Serializer(proto, 'mcpe_packet')
}

function createDeserializer (version) {
  const proto = getProtocol(version)
  return new FullPacketParser(proto, 'mcpe_packet')
}

module.exports = {
  createDeserializer: createDeserializer,
  createSerializer: createSerializer,
  createProtocol: createProtocol
}
