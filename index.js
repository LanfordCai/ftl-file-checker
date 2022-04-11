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
      
    basicValidationToFiles(files)

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

function basicValidationToFiles(files) {
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

async function validateJsonFiles(files) {
  const schemaPath = core.getInput("TOKEN_JSON_SCHEMA_PATH") 
  console.log(`token json schema path: ${schemaPath}`)
  
  const schema = JSON.parse(await getFileContent(schemaPath, "raw", "main"))
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (path.extname(file.filename) != ".json") {
      continue
    }
  
    await validateFileAgainstSchema(file, schema)
  }
}

async function validateFileAgainstSchema(file)  {
  const json = JSON.parse(await getFileContent(file.filename, "raw", ref))

  // const uuid = `${json.address}.${json.contractName}`
  const uuid = json.symbol
  if (tokenUUID != uuid) {
    throw new Error("UUIDs in path and token.json are mismatch")
  }

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
}

async function validateImages(files) {
  const imageMaxSize = core.getInput("IMAGE_MAX_SIZE") 
  console.log(`image max size is ${imageMaxSize}`) 

  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = path.extname(file.filename)
    if (ext != ".png" && ext != ".svg") {
      continue
    }
  
    const data = await getFileContent(file.filename, "json", ref)
    if (data.size > imageMaxSize) {
      const msg = `The size of ${file.filename} is ${data.size} bytes, exceeding the max size(${imageMaxSize} bytes)`
      core.info(`\u001b[38;2;255;0;0m${msg}`)
      throw new Error(msg)
    }
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