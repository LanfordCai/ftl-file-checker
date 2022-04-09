const core = require('@actions/core')
const github = require('@actions/github')
const path = require('path')
const Ajv = require("ajv")

const REGISTRY_DIR = "token-registry"
const VALID_FILES = [
  "logo.png",
  "token.json",
  "logo-large.png",
  "logo.svg",
  "testnet.token.json"
]

const REQUIRED_FILES = [
  "logo.png", 
  "token.json"
]

const ajv = new Ajv({allErrors: true})
let symbol = null

run()

async function run() {
  try {
    const owner = github.context.repo.owner
    const repo = github.context.repo.repo
    const prNumber = github.context.payload.pull_request.number
    const client = getOctokit()

    const labelsResp = await getLabels(client, owner, repo, prNumber)
    if (labelsResp.status != 200) {
      throw new Error("get labels failed")
    }
    const labels = labelsResp.data

    const filesResp = await pullFiles(client, owner, repo, prNumber)
    if (filesResp.status != 200) {
      throw new Error("pull files failed")
    }
    const files = filesResp.data

    const shouldValidateImages = core.getInput("VALIDATE_IMAGES")

    if (labels.some((label) => { return label.name == "NewToken" })) {
      core.info(`checkNewToken`)
      validateFiles(files)
      checkNewTokenFiles(files)
      core.info(`start validate json files`)
      await validateJsonFiles(client, owner, repo, files, symbol)
      if (shouldValidateImages) {
        await validateImages(client, owner, repo, files)
      }
    } else if (labels.some((label) => { return label.name == "UpdateToken" })) {
      core.info(`checkUpdateToken`)
      validateFiles(files)
      checkUpdateTokenFiles(files)
      core.info(`start validate json files`)
      await validateJsonFiles(client, owner, repo, files, symbol)
      if (shouldValidateImages) {
        await validateImages(client, owner, repo, files)
      }
    } else {
      core.info(`Unrelated`)
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

function checkNewTokenFiles(files) {
  let hasLogo = false
  let hasTokenJson = false
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.status != "added") {
      throw new Error("only add new file is allowed in a NewToken PR")
    }
    const [registryDir, tokenSymbol, filename] = file.filename.split("/") 
    if (!VALID_FILES.includes(filename)) {
      throw new Error("contains invalid file")
    }
    if (filename == "logo.png") {
      hasLogo = true
    }
    if (filename == "token.json") {
      hasTokenJson = true
    }
  }

  if (!(hasLogo && hasTokenJson)) {
    throw new Error("logo.png and token.json is required")
  }
}

function checkUpdateTokenFiles(files) {
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const [registryDir, tokenSymbol, filename] = file.filename.split("/") 
    if (!VALID_FILES.includes(filename)) {
      throw new Error("contains invalid file")
    } 
    if (file.status == "added" && (filename == "logo.png" || filename == "token.json")) {
      throw new Error("seems add new token rather than update token")
    }
  }
}

function validateFiles(files) {
  if (files.length > 5 || files.length == 0) { 
    throw new Error("invalid files count") 
  }
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const [registryDir, tokenSymbol, filename] = file.filename.split("/")
    if (tokenSymbol != tokenSymbol.toUpperCase()) {
      throw new Error(`token symbol should be uppercased, but it is ${tokenSymbol}`)
    }
    if (registryDir != REGISTRY_DIR) { 
      throw new Error(`changes happened out of ${REGISTRY_DIR}`) 
    }
    if (tokenSymbol.trim() == "") { 
      throw new Error(`invalid tokenSymbol ${tokenSymbol}`) 
    }
    if (!symbol) {
      symbol = tokenSymbol
    }
    if (symbol != tokenSymbol) {
      throw new Error(`more than one token changed! ${symbol} && ${tokenSymbol}`)
    }
  }
}

async function pullFiles(client, owner, repo, prNumber) {
  return await client.rest.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: prNumber,
  })
}

async function validateImages(client, owner, repo, files) {
  const imageMaxSize = core.getInput("IMAGE_MAX_SIZE") 
  console.log(`image max size is ${imageMaxSize}`) 

  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = path.extname(file.filename)
    if (ext != ".png" && ext != ".svg") {
      continue
    }
  
    core.info(`fetch image ${file.filename}`)
    const resp = await getFileContent(client, owner, repo, file, "json")
    if (resp.status != 200) {
      throw new Error("fetch image failed")
    }
    if (resp.data.size > imageMaxSize) {
      const msg = `The size of ${file.filename} is ${resp.data.size} bytes, exceed the max size ${imageMaxSize} bytes`
      core.info(`\u001b[38;2;255;0;0m${msg}`)
      throw new Error(msg)
    }
  } 
}

async function validateJsonFiles(client, owner, repo, files, symbol) {
  const resp = await fetchJsonSchema(client, owner, repo)
  if (resp.status != 200) {
    throw new Error("fetch json schema failed")
  }
  const schema = JSON.parse(resp.data)

  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (path.extname(file.filename) != ".json") {
      continue
    }
  
    core.info(`fetch file ${file.filename}`)
    const resp = await getFileContent(client, owner, repo, file, "raw")
    if (resp.status != 200) {
      throw new Error("fetch json file failed")
    }

    const data = JSON.parse(resp.data)
    if (data.symbol != symbol) {
      throw new Error(`symbols in path and ${file.filename} are mismatch`)
    }

    const validate = ajv.compile(schema)
    const valid = validate(data)
    if (!valid) {
      core.info(`--------------------------------------------------------`)
      core.info(`\u001b[38;2;255;0;0m${file.filename} is invalid`)
      validate.errors.forEach((err) => {
        core.info(`\u001b[38;2;255;0;0m${err.message}`)
      })
      core.info(`--------------------------------------------------------`)
      throw new Error("detect invalid json file")
    }
  }
}

async function fetchJsonSchema(client, owner, repo) {
  const contentPath = core.getInput("TOKEN_JSON_SCHEMA_PATH") 
  console.log(`content path ${contentPath}`)

  return await client.rest.repos.getContent({
    mediaType: {
      format: ["raw"],
    },
    owner: owner, 
    repo: repo,
    path: contentPath,
  })
}

async function getFileContent(client, owner, repo, file, format) {
  const [p, ref] = file.contents_url.split("ref=")
  return await client.rest.repos.getContent({
    mediaType: {
      format: [format],
    },
    owner: owner, 
    repo: repo,
    path: file.filename,
    ref: ref
  })
}

async function getLabels(client, owner, repo, prNumber) {
  return await client.rest.issues.listLabelsOnIssue({
    owner: owner,
    repo: repo,
    issue_number: prNumber
  })
}

function getOctokit() {
  const gh_token = process.env.GITHUB_TOKEN
  const octokit = github.getOctokit(token=gh_token)
  return octokit
}