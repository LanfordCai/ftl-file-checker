const core = require('@actions/core')
const github = require('@actions/github')
const path = require('path')
const Ajv = require("ajv")
const ajv = new Ajv({allErrors: true})

const REGISTRY_DIR = "token-registry"
const VALID_FILES = [
  "logo.png",
  "token.json",
  "logo-large.png",
  "logo.svg",
  "testnet.token.json"
]

let client = null
let owner = null
let repo = null
let prNumber = null
let ref = null

let tokenUUID = null

run()

async function run() {
  try {
    owner = github.context.repo.owner
    repo = github.context.repo.repo
    prNumber = github.context.payload.pull_request.number
    client = getOctokit()
    ref = core.getInput("REF")
    console.log(ref)

    const shouldValidateImages = core.getInput("VALIDATE_IMAGES")

    const labels = await getLabels()
    const withNewTokenLabel = labels.some((label) => label.name == "NewToken")
    const withUpdateTokenLabel = labels.some((label) => label.name == "UpdateToken")

    if (!withNewTokenLabel && !withUpdateTokenLabel) {
      core.info(`This PR is UnrelatedToToken`)
      return
    }

    const files = (await getPRFiles())
      .filter((file) => { return file.status != "removed"} )
      
    validateChangedFiles(files)
    await validateDirectory()

    core.info("start validating json files")
    await validateJsonFiles(files)

    if (shouldValidateImages) {
      core.info("start validating images")
      await validateImages(files)
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

function validateChangedFiles(files) {
  if (files.length > 5 || files.length == 0) { 
    throw new Error("invalid files count") 
  }

  let registryDirs = []
  let tokenUUIDs = []
  for (var i = 0; i < files.length; i++) {
    const [registryDir, tokenUUID,] = files[i].filename.split("/")
    registryDirs.push(registryDir)
    tokenUUIDs.push(tokenUUID)
  }

  const registryDirSet = new Set(registryDirs)
  if (registryDirSet.size > 1) {
    throw new Error(`modifications are only allowed within ${REGISTRY_DIR}`) 
  }

  const tokenUUIDSet = new Set(tokenUUIDs) 
  if (tokenUUIDSet.size > 1) {
    throw new Error(`more than one token changed!`)
  }
  
  tokenUUID = tokenUUIDs[0]
}

async function validateDirectory() {
  const files = await getTokenDirectory(tokenUUID)
  let hasLogo = false
  let hasTokenJson = false
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (!VALID_FILES.includes(file.name)) {
      core.info(`contains invalid file: ${file.name}`)
      core.info(`valid files are:`)
      VALID_FILES.forEach((filename) => {
        core.info(`\u001b[38;2;255;0;0m${filename}`) 
      })
      throw new Error("contains invalid file")
    }

    if (file.name == "logo.png") {
      hasLogo = true
    }
    if (file.name == "token.json") {
      hasTokenJson = true
    }
  }

  if (!(hasLogo && hasTokenJson)) {
    throw new Error("logo.png and token.json are required")
  }
}

async function validateJsonFiles(files) {
  const schemaPath = core.getInput("TOKEN_JSON_SCHEMA_PATH") 
  console.log(`token json schema path: ${schemaPath}`)
  
  const schema = JSON.parse(await getFileContent(schemaPath, "raw", "main"))
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (path.extname(file.filename) != ".json") {
      continue
    }
  
    await validateSingleJsonFile(file, schema)
  }
}

async function validateSingleJsonFile(file, schema)  {
  const json = JSON.parse(await getFileContent(file.filename, "raw", ref))

  const uuid = `A.${json.address}.${json.contractName}`
  core.info(uuid)
  core.info(tokenUUID)
  if (tokenUUID != uuid) {
    throw new Error("UUIDs in path and token.json are mismatch")
  }

  core.info(`validating ${file.filename}`)
  const validate = ajv.compile(schema)
  const valid = validate(json)
  if (!valid) {
    core.info(`--------------------------------------------------------`)
    core.info(`\u001b[38;2;255;0;0m${file.filename} is invalid`)
    validate.errors.forEach((err) => {
      core.info(`\u001b[38;2;255;0;0m${err.message}`)
    })
    core.info(`--------------------------------------------------------`)
    throw new Error("invalid json file detected")
  }
  core.info(`${file.filename} is valid`)

  await validateUniqueness(file.filename, json)
}

async function validateUniqueness(filename, json) {
  let tokenlistPath = "src/tokens/flow-mainnet.tokenlist.json" 
  if (filename == "testnet.token.json") {
    tokenlistPath = "src/tokens/flow-testnet.tokenlist.json" 
  }

  const tokenlist = JSON.parse(await getFileContent(tokenlistPath, "raw", "main"))
  const names = tokenlist.tokens.map((token) => token.name)
  if (names.includes(json.name)) {
    throw new Error("token name duplicated")
  }

  const uuids = tokenlist.tokens.map((token) => `A.${token.address}.${token.contractName}`)
  if (uuids.includes(`A.${json.address}.${json.contractName}`)) {
    throw new Error("A.{tokenAdress}.{tokenContractName} duplicated")
  }
  core.info(`${filename} isn't existed yet`)
}

async function validateImages(files) {
  const imageMaxSize = core.getInput("IMAGE_MAX_SIZE") 
  core.info(`image max size is ${imageMaxSize}`) 

  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = path.extname(file.filename)
    if (ext != ".png" && ext != ".svg") {
      continue
    }
  
    const data = await getFileContent(file.filename, "json", ref)
    core.info(`validating ${file.filename}`)
    if (data.size > imageMaxSize) {
      const msg = `The size of ${file.filename} is ${data.size} bytes, exceeding the max size(${imageMaxSize} bytes)`
      core.info(`\u001b[38;2;255;0;0m${msg}`)
      throw new Error(msg)
    }
    core.info(`${file.filename} is valid`)
  } 
}

async function getFileContent(path, format, ref) {
  const resp = await client.rest.repos.getContent({
    mediaType: {
      format: [format],
    },
    owner: owner, 
    repo: repo,
    path: path,
    ref: ref
  })

  if (resp.status != 200) {
    throw new Error(`get file failed: ${path}`)
  }

  return resp.data
}

async function getTokenDirectory(tokenUUID) {
  const resp = await client.rest.repos.getContent({
    mediaType: {
      format: ["raw"],
    },
    owner: owner, 
    repo: repo,
    path: `${REGISTRY_DIR}/${tokenUUID}`,
    ref: ref
  })

  if (resp.status != 200) {
    throw new Error(`get directory contents failed: ${resp.status}`)
  }

  return resp.data
}

async function getLabels() {
  const resp = await client.rest.issues.listLabelsOnIssue({
    owner: owner,
    repo: repo,
    issue_number: prNumber
  })

  if (resp.status != 200) {
    throw new Error("get labels failed")
  }

  return resp.data
}

async function getPRFiles() {
  const resp = await client.rest.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: prNumber,
  })

  if (resp.status != 200) {
    throw new Error("get PR files failed")
  }

  return resp.data
}

function getOctokit() {
  const gh_token = process.env.GITHUB_TOKEN
  const octokit = github.getOctokit(token=gh_token)
  return octokit
}