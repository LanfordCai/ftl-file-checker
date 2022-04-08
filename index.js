const core = require('@actions/core')
const github = require('@actions/github')

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
    core.info(labels.length)

    const filesResp = await pullFiles(client, owner, repo, prNumber)
    if (filesResp.status != 200) {
      throw new Error("pull files failed")
    }
    const files = filesResp.data

    if (labels.some((label) => { label.name == "NewToken" })) {
      core.info(`checkNewTokenFiles`)
      validateFiles(files)
      checkNewTokenFiles(files)
    } else if (labels.some((label) => { label.name == "UpdateToken" })) {
      core.info(`checkUpdateTokenFiles`)
      validateFiles(files)
      checkUpdateTokenFiles(files)
    } else {
      core.info(`label is: ${labels[0].name}`)
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

function checkNewTokenFiles(files) {
  let hasLogo = false
  let hasTokenJson = false
  core.info(`ready to loop`)
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    core.info(`status: ${file.status}`)
    if (file.status != "added") {
      throw new Error("only add new file is allowed in a NewToken PR")
    }
    core.info(`ready to split`)
    const [registryDir, tokenSymbol, filename] = file.filename.split("/") 
    core.info(`filename: ${filename} full_filename: ${file.filename}`)
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
  let symbol = null
  if (files.length > 5 || files.length == 0) { 
    throw new Error("invalid files count") 
  }
  for (var i = 0; i < files.length; i++) {
    const file = files[i]
    const [registryDir, tokenSymbol, filename] = file.filename.split("/")
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