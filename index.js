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
    const files = filesResp.data.filter((file) => { return file.status != "deleted"} )

    const shouldValidateImages = core.getInput("VALIDATE_IMAGES")

    if (labels.some((label) => { return label.name == "NewToken" })) {
      core.info(`[NewToken] start checking files`)
      validateFiles(files)
      checkNewTokenFiles(files)
      core.info(`[NewToken] start validating json files`)
      await validateJsonFiles(client, owner, repo, files, symbol)
      if (shouldValidateImages) {
        core.info(`[NewToken] start validating images`)
        await validateImages(client, owner, repo, files)
      }
    } else if (labels.some((label) => { return label.name == "UpdateToken" })) {
      core.info(`[UpdateToken] start checking files`)
      validateFiles(files)
      checkUpdateTokenFiles(files)
      core.info(`[UpdateToken] start validating json files`)
      await validateJsonFiles(client, owner, repo, files, symbol)
      if (shouldValidateImages) {
        core.info(`[UpdateToken] start validating images`)
        await validateImages(client, owner, repo, files)
      }
    } else {
      core.info(`This PR is UnrelatedToToken`)
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
      throw new Error("only adding new files is allowed in a NewToken PR")
    }
    const [,, filename] = file.filename.split("/") 
    if (!VALID_FILES.includes(filename)) {
      core.info(`contains invalid file: ${file.filename}`)
      core.info(`valid files are:`)
      VALID_FILES.forEach((filename) => {
        core.info(`\u001b[38;2;255;0;0m${filename}`) 
      })
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
    throw new Error("logo.png and token.json are required for NewToken PR")
  }
}

function checkUpdateTokenFiles(files) {
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const [,, filename] = file.filename.split("/") 
    if (!VALID_FILES.includes(filename)) {
      core.info(`contains invalid file: ${file.filename}`)
      core.info(`valid files are:`)
      VALID_FILES.forEach((filename) => {
        core.info(`\u001b[38;2;255;0;0m${filename}`) 
      })
      throw new Error("contains invalid file")
    } 
    if (file.status == "added" && (filename == "logo.png" || filename == "token.json")) {
      throw new Error("this seems like a NewToken PR rather than an UpdateToken PR")
    }
  }
}

function validateFiles(files) {
  if (files.length > 5 || files.length == 0) { 
    throw new Error("invalid files count") 
  }
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const [registryDir, tokenSymbol,] = file.filename.split("/")
    if (registryDir != REGISTRY_DIR) { 
      throw new Error(`modifications are only allowed within ${REGISTRY_DIR}`) 
    }
    if (tokenSymbol.trim() == "") { 
      throw new Error(`invalid token symbol: ${tokenSymbol}`) 
    }
    if (!symbol) {
      symbol = tokenSymbol
    }
    if (symbol != tokenSymbol) {
      throw new Error(`more than one token changed: ${symbol} && ${tokenSymbol}`)
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
  
    const resp = await getFileContent(client, owner, repo, file, "json")
    if (resp.status != 200) {
      throw new Error(`fetch image failed: ${file.filename}`)
    }
    if (resp.data.size > imageMaxSize) {
      const msg = `The size of ${file.filename} is ${resp.data.size} bytes, exceeding the max size(${imageMaxSize} bytes)`
      core.info(`\u001b[38;2;255;0;0m${msg}`)
      throw new Error(msg)
    }
  } 
}

async function validateJsonFiles(client, owner, repo, files, symbol) {
  const resp = await getJsonSchema(client, owner, repo)
  if (resp.status != 200) {
    throw new Error("fetch json schema failed")
  }
  const schema = JSON.parse(resp.data)

  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    if (path.extname(file.filename) != ".json") {
      continue
    }
  
    const resp = await getFileContent(client, owner, repo, file, "raw")
    if (resp.status != 200) {
      throw new Error(`fetch json file failed: ${file.filename}`)
    }

    const data = JSON.parse(resp.data)
    if (data.symbol != symbol) {
      throw new Error(`symbols in path and ${file.filename} are mismatched`)
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
      throw new Error("invalid json file detected")
    }
  }
}

async function getJsonSchema(client, owner, repo) {
  const contentPath = core.getInput("TOKEN_JSON_SCHEMA_PATH") 
  console.log(`token json schema path: ${contentPath}`)

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
  const [, ref] = file.contents_url.split("ref=")
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