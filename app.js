const express = require("express");
const MongoClient = require('mongodb').MongoClient;
const sendgrid = require("@sendgrid/mail");
const app = express();
const bodyParser = require('body-parser');
const port = process.env.PORT || 3001;
const CryptoJS = require("crypto-js");

const cors = require('cors')
app.use(cors())

app.use(bodyParser.json({ limit: "30mb", extended: true }))
app.use(bodyParser.urlencoded({ limit: "30mb", extended: true }))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader(
    'Access-Control-Allow-Methods',
    'OPTIONS, GET, POST, PUT, PATCH, DELETE'
  )
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  next()
})

require('dotenv').config();

sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VMS_REGEX = /\*VMS\*([\d.]+)\*VMS\*/

const sendEmail = async (
  recipient,
  subject,
  html
) => {
  console.log("sending an email");
  const message = {
    to: recipient,
    from: "hello@solute.ai",
    subject,
    html,
  }
  try {
    await sendgrid.send(message)
  } catch (e) {
    console.log(e)
  }
}

app.get("/", (req, res) => res.type('html').send(html));
app.post("/post-test", (req, res) => {
  res.status(200).json({ message: 'Nice' })
  sendEmail(
    "romansvistellviv@gmail.com",
    `(via Solute) - New submission received`,
    getHTML({
      job: {
        id: "1",
        name: "",
      },
      candidate: {
        name: "",
        email: "",
        vacancyMatchScore: 2,
      },
      aiAnalysisSummary: "aiOutput",
    }),
  )
});
app.post("/process-submission", async (req, res) => {
  try {
    const userPrompt = req.body.userPrompt || ""
    const model = req.body.model || ""
    const formApp = req.body.formApp
    const formId = req.body.formId

    console.log({
      userPrompt,
      model,
      formApp,
      formId
    })

    const aiInput = generateAIInput(formApp, userPrompt)
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: aiInput,
        },
        {
          role: "user",
          content: "",
        },
      ],
      // @ts-ignore
      max_tokens: 1000,
      temperature: 1,
    })

    console.log("completion");
    console.log(completion);

    const aiResponse = completion.choices[0].message?.content
    if (!aiResponse) throw new Error("AI response is empty")

    const vms = aiResponse.match(VMS_REGEX)?.[1]
    const vacancyMatchScore = vms ? parseInt(vms) : 0
    const aiOutput = aiResponse
      .replace(VMS_REGEX, "")
      .replaceAll("```html", "")
      .replaceAll("```", "")

    const emailNotifications = formApp?.general.emailNotifications
    const collectSubmissions = formApp?.general.collectSubmissions
    console.log("emailNotifications");
    console.log(emailNotifications);
    console.log("emailNotifications");
    console.log(emailNotifications);
    console.log("collectSubmissions");
    console.log(collectSubmissions);
    const tasksToPerform = []
    if (
      emailNotifications &&
      emailNotifications?.enabled &&
      emailNotifications?.recipient
    ) {
      console.log("tasksToPerform.push(");
      tasksToPerform.push(
        sendEmail(
          emailNotifications?.recipient,
          `${formApp?.general.name} (via Solute) - New submission received ${userPrompt["candidate-name"]?.value ? `from ${userPrompt["candidate-name"]?.value}` : ""}`,
          getHTML({
            job: {
              id: formId,
              name: formApp.general.name,
            },
            candidate: {
              name: userPrompt["candidate-name"].value,
              email: userPrompt["candidate-email"].value,
              vacancyMatchScore,
            },
            aiAnalysisSummary: aiOutput,
          }),
        ),
      )
    }

    console.log("collectSubmissions");
    console.log(collectSubmissions);

    if (collectSubmissions) {
      console.log("tasksToPerform.push(");
      tasksToPerform.push(
        saveSubmission({
          formId: formId,
          aiOutput,
          vacancyMatchScore,
          userSubmission: userPrompt,
          aiInput,
          createdAt: new Date(),
          status: "New",
        }),
      )
    }

    try {
      console.log("tasksToPerform");
      console.log(tasksToPerform);
      await Promise.all(tasksToPerform)
      console.log("completed");
    } catch (e) {
      console.warn("An error occurred while performing tasks")
      console.log(e)
    }

    return aiOutput
  } catch (e) {
    console.log(e);
  }
});

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const encryptSubmission = (submission) => {
  const CRYPTO_SECRET_KEY = process.env.CRYPTO_SECRET_KEY
  if (!CRYPTO_SECRET_KEY)
    throw new Error("CRYPTO_SECRET_KEY is not defined in your .env file")
  const encrypt = (data) => {
    const encrypted = CryptoJS.AES.encrypt(data, CRYPTO_SECRET_KEY)
    return encrypted.toString()
  }
  return {
    ...submission,
    aiOutput: encrypt(submission.aiOutput),
    userSubmission: encrypt(JSON.stringify(submission.userSubmission)),
    aiInput: encrypt(submission.aiInput),
  }
}

const saveSubmission = async (submission) => {
  console.log("saveSubmission");
  let database
  let dbo
  MongoClient.connect(process.env.MONGODB_URI)
    .then(async (db) => {
      console.log(db);
      database = db
      dbo = db.db(process.env.MONGODB_DB);
      try {
        const newSubmission = encryptSubmission(submission)
        const result = await dbo
          .collection("submissions")
          .insertOne(newSubmission)

        if (result.acknowledged && result.insertedId) {
          return {status: 201, message: "Submission saved!"}
        } else {
          return {status: 500, message: "Submission is not saved!"}
        }
      } catch (err) {
        return {status: 500, message: "Submission is not saved!"}
      } finally {
        await database.close();
      }
    })
    .catch(err => {
      throw err
    })
}

const generateAIInput = (formApp, userPrompt) => {
  const PrivateUserPromptKeys = [
    "candidate-name",
    "candidate-email",
    "linkedin",
  ]
  return `
    Your goal is to write a short summary about a candidate and give some recommendation for a recruitment team.
    
    This the vacancy:
    Vacancy name: ${formApp?.general.name}
    ${
    formApp?.general.vacancy?.company &&
    `Company: ${formApp?.general.vacancy?.company}`
  }
    ${
    formApp?.general.vacancy?.location &&
    `Location: ${formApp?.general.vacancy?.location}`
  }
    ${
    formApp?.general.vacancy?.type &&
    `Cooperation type: ${formApp?.general.vacancy?.type}`
  }
    Vacancy description: ${formApp?.general.vacancy?.description}
    ${
    formApp?.general.vacancy?.instructions &&
    `Here are some additional notes you should keep in mind write writing your summary: ${formApp?.general.vacancy?.instructions}`
  }
    
    Here is the information about the candidate.
    ${
    userPrompt &&
    Object.entries(userPrompt)
      .map((input) => {
        const [inputId, inputData] = input
        if (inputId in PrivateUserPromptKeys) return ""

        return `${inputData.label}: ${inputData.value}`
      })
      .join(";\n")
  }
    
    Please don't hypnotise and write your summary only based on the information the candidate provided, never on your guesses. 
    If some information about the candidate is missing, please say that and recommend recruiter to ask about it.
    Try to be as objective as possible.
    Please give a brief summary about the candidate. His/her strong and weak sides. 
    And would you recommend me to invite her/him for an interview or the candidate is definitely not a good fit for this job.
    
    Keep it laconic and easy-to-read. Output the result as HTML rich text.
    Please give the candidate a 'vacancy match score', you will base this score based on the candidate's information and whether he/she fits the vacancy.
    The score values are between 1 to 10, 1 is the lowest score and 10 is the highest score.
    Include the score in the following way '*VMS*{the score}*VMS*' at the end of your summary.
  `
}

const SOLUTE_BASE_URL = "https://recruit-sandbox.solute.ai"

const scoreToParagraph = (score) => {
  if (score >= 8)
    return "Prepare for liftoff! This candidate's score is so high, NASA called asking for tips.\nThey're not just a match; they're a cosmic convergence of talent.\nWe might need to reserve them a parking spot for their spaceship!"
  if (score >= 5)
    return `Decisions, decisions! This candidate is like choosing between pizza toppings – it's all good, just a matter of personal taste.\nThey scored a solid ${score} out of 10.\nThink of it as finding the perfect blend of flavors; let's spice things up!`
  return `Houston, we have a situation, but fear not, Captain Recruiter!\nThis candidate may need a bit more nurturing, like a baby Yoda in a professional development pod.\nThey've scored ${score} out of 10, but who knows, maybe they're just waiting for the right cosmic mentor.`
}
function shortenHtml(htmlString, maxChars) {
  if (htmlString.length <= maxChars) {
    return htmlString
  }

  let currentLength = 0
  let result = ""

  const tagRegex = /<[^>]*>.*?<\/[^>]*>/g
  const matches = htmlString.match(tagRegex)

  if (matches) {
    for (const match of matches) {
      const remainingSpace = maxChars - currentLength

      if (match.length <= remainingSpace) {
        result += match
        currentLength += match.length
      } else {
        result += match.slice(0, remainingSpace)
        break
      }
    }
  }

  return result
}
const getHTML = ({job, candidate, aiAnalysisSummary}) => {
  const vacancyMatchScoreParagraph = scoreToParagraph(
    candidate.vacancyMatchScore,
  )
  const aiSummaryShortend = shortenHtml(aiAnalysisSummary, 250)
  return `<html dir="ltr" xmlns="http://www.w3.org/1999/xhtml"  lang="und">
<head>
  <meta http-equiv="Content-Security-Policy"
        content="script-src 'none'; connect-src 'none'; object-src 'none'; form-action 'none';">
  <meta charset="UTF-8">
  <meta content="width=device-width, initial-scale=1" name="viewport">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta content="telephone=no" name="format-detection">
  <title></title>
  <!--[if (mso 16)]>
  <style type="text/css">
    a {
      text-decoration: none;
    }
  </style>
  <![endif]-->
  <!--[if gte mso 9]>
  <style>sup {
    font-size: 100% !important;
  }</style><![endif]-->
  <!--[if gte mso 9]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG></o:AllowPNG>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <style type="text/css">#outlook a {
      padding: 0;
  }

  .es-button {
      mso-style-priority: 100 !important;
      text-decoration: none !important;
  }

  a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
  }

  .es-desk-hidden {
      display: none;
      float: left;
      overflow: hidden;
      width: 0;
      max-height: 0;
      line-height: 0;
      mso-hide: all;
  }

  @media only screen and (max-width: 600px) {
      p, ul li, ol li, a {
          line-height: 150% !important
      }

      h1, h2, h3, h1 a, h2 a, h3 a {
          line-height: 120% !important
      }

      h1 {
          font-size: 36px !important;
          text-align: left
      }

      h2 {
          font-size: 26px !important;
          text-align: left
      }

      h3 {
          font-size: 20px !important;
          text-align: left
      }

      .es-header-body h1 a, .es-content-body h1 a, .es-footer-body h1 a {
          font-size: 36px !important;
          text-align: left
      }

      .es-header-body h2 a, .es-content-body h2 a, .es-footer-body h2 a {
          font-size: 26px !important;
          text-align: left
      }

      .es-header-body h3 a, .es-content-body h3 a, .es-footer-body h3 a {
          font-size: 20px !important;
          text-align: left
      }

      .es-menu td a {
          font-size: 12px !important
      }

      .es-header-body p, .es-header-body ul li, .es-header-body ol li, .es-header-body a {
          font-size: 14px !important
      }

      .es-content-body p, .es-content-body ul li, .es-content-body ol li, .es-content-body a {
          font-size: 14px !important
      }

      .es-footer-body p, .es-footer-body ul li, .es-footer-body ol li, .es-footer-body a {
          font-size: 14px !important
      }

      .es-infoblock p, .es-infoblock ul li, .es-infoblock ol li, .es-infoblock a {
          font-size: 12px !important
      }

      *[class="gmail-fix"] {
          display: none !important
      }

      .es-m-txt-c, .es-m-txt-c h1, .es-m-txt-c h2, .es-m-txt-c h3 {
          text-align: center !important
      }

      .es-m-txt-r, .es-m-txt-r h1, .es-m-txt-r h2, .es-m-txt-r h3 {
          text-align: right !important
      }

      .es-m-txt-l, .es-m-txt-l h1, .es-m-txt-l h2, .es-m-txt-l h3 {
          text-align: left !important
      }

      .es-m-txt-r img, .es-m-txt-c img, .es-m-txt-l img {
          display: inline !important
      }

      .es-button-border {
          display: inline-block !important
      }

      a.es-button, button.es-button {
          font-size: 20px !important;
          display: inline-block !important
      }

      .es-adaptive table, .es-left, .es-right {
          width: 100% !important
      }

      .es-content table, .es-header table, .es-footer table, .es-content, .es-footer, .es-header {
          width: 100% !important;
          max-width: 600px !important
      }

      .es-adapt-td {
          display: block !important;
          width: 100% !important
      }

      .adapt-img {
          width: 100% !important;
          height: auto !important
      }

      .es-m-p0 {
          padding: 0 !important
      }

      .es-m-p0r {
          padding-right: 0 !important
      }

      .es-m-p0l {
          padding-left: 0 !important
      }

      .es-m-p0t {
          padding-top: 0 !important
      }

      .es-m-p0b {
          padding-bottom: 0 !important
      }

      .es-m-p20b {
          padding-bottom: 20px !important
      }

      .es-mobile-hidden, .es-hidden {
          display: none !important
      }

      tr.es-desk-hidden, td.es-desk-hidden, table.es-desk-hidden {
          width: auto !important;
          overflow: visible !important;
          float: none !important;
          max-height: inherit !important;
          line-height: inherit !important
      }

      tr.es-desk-hidden {
          display: table-row !important
      }

      table.es-desk-hidden {
          display: table !important
      }

      td.es-desk-menu-hidden {
          display: table-cell !important
      }

      .es-menu td {
          width: 1% !important
      }

      table.es-table-not-adapt, .esd-block-html table {
          width: auto !important
      }

      table.es-social {
          display: inline-block !important
      }

      table.es-social td {
          display: inline-block !important
      }

      .es-m-p5 {
          padding: 5px !important
      }

      .es-m-p5t {
          padding-top: 5px !important
      }

      .es-m-p5b {
          padding-bottom: 5px !important
      }

      .es-m-p5r {
          padding-right: 5px !important
      }

      .es-m-p5l {
          padding-left: 5px !important
      }

      .es-m-p10 {
          padding: 10px !important
      }

      .es-m-p10t {
          padding-top: 10px !important
      }

      .es-m-p10b {
          padding-bottom: 10px !important
      }

      .es-m-p10r {
          padding-right: 10px !important
      }

      .es-m-p10l {
          padding-left: 10px !important
      }

      .es-m-p15 {
          padding: 15px !important
      }

      .es-m-p15t {
          padding-top: 15px !important
      }

      .es-m-p15b {
          padding-bottom: 15px !important
      }

      .es-m-p15r {
          padding-right: 15px !important
      }

      .es-m-p15l {
          padding-left: 15px !important
      }

      .es-m-p20 {
          padding: 20px !important
      }

      .es-m-p20t {
          padding-top: 20px !important
      }

      .es-m-p20r {
          padding-right: 20px !important
      }

      .es-m-p20l {
          padding-left: 20px !important
      }

      .es-m-p25 {
          padding: 25px !important
      }

      .es-m-p25t {
          padding-top: 25px !important
      }

      .es-m-p25b {
          padding-bottom: 25px !important
      }

      .es-m-p25r {
          padding-right: 25px !important
      }

      .es-m-p25l {
          padding-left: 25px !important
      }

      .es-m-p30 {
          padding: 30px !important
      }

      .es-m-p30t {
          padding-top: 30px !important
      }

      .es-m-p30b {
          padding-bottom: 30px !important
      }

      .es-m-p30r {
          padding-right: 30px !important
      }

      .es-m-p30l {
          padding-left: 30px !important
      }

      .es-m-p35 {
          padding: 35px !important
      }

      .es-m-p35t {
          padding-top: 35px !important
      }

      .es-m-p35b {
          padding-bottom: 35px !important
      }

      .es-m-p35r {
          padding-right: 35px !important
      }

      .es-m-p35l {
          padding-left: 35px !important
      }

      .es-m-p40 {
          padding: 40px !important
      }

      .es-m-p40t {
          padding-top: 40px !important
      }

      .es-m-p40b {
          padding-bottom: 40px !important
      }

      .es-m-p40r {
          padding-right: 40px !important
      }

      .es-m-p40l {
          padding-left: 40px !important
      }

      button.es-button {
          width: 100%
      }

      .es-desk-hidden {
          display: table-row !important;
          width: auto !important;
          overflow: visible !important;
          max-height: inherit !important
      }
  }

  @media screen and (max-width: 384px) {
      .mail-message-content {
          width: 414px !important
      }
  }</style>
  <style>* {
      scrollbar-width: thin;
      scrollbar-color: #888 #f6f6f6;
  }

  /* Chrome, Edge, Safari */
  ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
  }

  ::-webkit-scrollbar-track {
      background: #f6f6f6;
  }

  ::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 6px;
      border: 2px solid #f6f6f6;
  }

  ::-webkit-scrollbar-thumb:hover {
      box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
  }

  textarea::-webkit-scrollbar-track {
      margin: 15px;
  }</style>
</head>
<body
  style="width:100%;font-family:arial, 'helvetica neue', helvetica, sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;padding:0;Margin:0">
<div dir="ltr" class="es-wrapper-color" lang="und" style="background-color:#F1EBFC">
  <!--[if gte mso 9]>
  <v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t">
    <v:fill type="tile" color="#F1EBFC"></v:fill>
  </v:background>
  <![endif]-->
  <table class="es-wrapper" width="100%" cellspacing="0" cellpadding="0" role="none"
         style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;padding:0;Margin:0;width:100%;height:100%;background-repeat:repeat;background-position:center top;background-color:#F1EBFC">
    <tbody>
    <tr>
      <td valign="top" style="padding:0;Margin:0">
        <table cellpadding="0" cellspacing="0" class="es-content" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0"
                     role="none"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#FFFFFF;width:600px">
                <tbody>
                <tr>
                  <td align="left" bgcolor="#7C39EA" style="padding:20px;Margin:0;background-color:#7c39ea">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%" bgcolor="#7C39EA"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;border-width:10px;border-style:solid;border-color:transparent;background-color:#7c39ea"
                                 role="presentation">
                            <tbody>
                            <tr>
                              <td align="center" style="padding:0;Margin:0;font-size:0px"><img class="adapt-img"
                                                                                               src="https://ecqckvr.stripocdn.email/content/guids/CABINET_9365355ef273f24312e493722d52a0da0e78cddc25b5fb96dee4c90ec2336ccd/images/frame_101_MJS.png"
                                                                                               alt=""
                                                                                               style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"
                                                                                               width="240"></td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="es-content" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0"
                     role="none"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#FFFFFF;width:600px">
                <tbody>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                            <tbody>
                            <tr>
                              <td align="center" style="padding:0;Margin:0;padding-top:5px;font-size:0px"><img
                                src="https://ecqckvr.stripocdn.email/content/guids/CABINET_9365355ef273f24312e493722d52a0da0e78cddc25b5fb96dee4c90ec2336ccd/images/undraw_new_message_re_fp03.png"
                                alt="Email Banner_Your ALT goes here"
                                style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;font-size:12px"
                                title="Email Banner_Your ALT goes here" width="300"></td>
                            </tr>
                            <tr>
                              <td align="center" class="es-m-txt-c"
                                  style="padding:0;Margin:0;padding-bottom:10px;padding-top:20px"><h1
                                style="Margin:0;line-height:36px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:36px;font-style:normal;font-weight:bold;color:#333333">
                                🚀 New Candidate Alert for <br></h1>
                                <h1
                                  style="Margin:0;line-height:36px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:36px;font-style:normal;font-weight:bold;color:#333333">
                                  ${job.name}!</h1></td>
                            </tr>
                            <tr>
                              <td align="left" style="padding:0;Margin:0;padding-top:5px;padding-bottom:10px"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                Exciting news! 🎉 We've just received ${candidate.name}'s application for the ${job.name} position, and it's time to roll out the cosmic welcome mat for our newest
                                contender.</p></td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="es-content" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0"
                     role="none"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#FFFFFF;width:600px">
                <tbody>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:separate;border-spacing:0px;border-width:10px;border-style:solid;border-color:transparent;background-color:#eceef8;border-radius:12px"
                                 bgcolor="#eceef8" role="presentation">
                            <tbody>
                            <tr>
                              <td align="center" class="es-m-txt-c" style="padding:0;Margin:0;padding-bottom:15px"><h2
                                style="Margin:0;line-height:31px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:26px;font-style:normal;font-weight:bold;color:#333333">
                                Applicant Details 📇</h2>
                              </td>
                            </tr>
                            <tr>
                              <td align="left" class="es-m-txt-c" style="padding:5px;Margin:0"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                <strong>Name</strong>: ${candidate.name}</p></td>
                            </tr>
                            <tr>
                              <td align="left" class="es-m-txt-c" style="padding:5px;Margin:0"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                <strong>Email</strong>: <a target="_blank"
                                                           href="mailto:${candidate.email}?subject=Re:%20Your%20Job%20Application%20(${job.name})"
                                                           style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#5C68E2;font-size:14px">${candidate.email}</a></p></td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="es-content" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0"
                     role="none"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#FFFFFF;width:600px">
                <tbody>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                            <tbody>
                            <tr>
                              <td align="center" style="padding:0;Margin:0"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                Now, for the AI Analysis Summary and the 🤖✨ - prepare for an odyssey through the
                                brilliance of the applicant's mind; it's like a deep space probe, but smarter,
                                dissecting their technical mastery, creative genius, and linguistic finesse. Solute's AI
                                has never felt so intellectually validated! 🧠</p>
                              </td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:separate;border-spacing:0px;border-width:10px;border-style:solid;border-color:transparent;background-color:#eee4ff;border-radius:12px"
                                 bgcolor="#eee4ff" role="presentation">
                            <tbody>
                            <tr>
                              <td align="center" class="es-m-txt-c" style="padding:0;Margin:0;padding-bottom:15px"><h2
                                style="Margin:0;line-height:31px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:26px;font-style:normal;font-weight:bold;color:#333333">
                                AI Analysis Summary 🪄</h2>
                              </td>
                            </tr>
                            <tr>
                              <td align="left" style="padding:5px;Margin:0">
                                <p
                                  style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                  ${aiSummaryShortend}... <a target="_blank"
                                                           href="${SOLUTE_BASE_URL}/dashboard/submissions/form/${job.id}/"
                                                           style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#5C68E2;font-size:14px"><strong>Read more</strong></a>
                                  
                                  </p>
                                </p>
                              </td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                            <tbody>
                            <tr>
                              <td align="center" style="padding:0;Margin:0"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                Now, onto the Candidate Vacancy Match Score 🌟 - it's not just a number; it's the cosmic
                                alignment of this applicant's qualities with the job requirements. Brace yourselves for
                                a match score; Solute's AI is feeling pretty smug right about now! 🌌</p>
                              </td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:separate;border-spacing:0px;border-width:10px;border-style:solid;border-color:transparent;background-color:#bba7e4;border-radius:12px"
                                 bgcolor="#bba7e4" role="presentation">
                            <tbody>
                            <tr>
                              <td align="center" class="es-m-txt-c" style="padding:0;Margin:0;padding-bottom:15px"><h2
                                style="Margin:0;line-height:31px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:26px;font-style:normal;font-weight:bold;color:#333333">
                                <strong>Candidate Vacancy Match Score:</strong> 🌟 ${candidate.vacancyMatchScore}/10</h2>
                              </td>
                            </tr>
                            <tr>
                              <td align="left" style="padding:5px;Margin:0">
                                <p style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                  ${vacancyMatchScoreParagraph}
                                </p>
                              </td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="es-content" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0"
                     role="none"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#FFFFFF;width:600px">
                <tbody>
                <tr>
                  <td align="left" style="padding:20px;Margin:0">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                          <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                            <tbody>
                            <tr>
                              <td align="center" style="padding:20px;Margin:0;font-size:0">
                                <table border="0" width="100%" height="100%" cellpadding="0" cellspacing="0"
                                       role="presentation"
                                       style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                                  <tbody>
                                  <tr>
                                    <td
                                      style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:1px;width:100%;margin:0px"></td>
                                  </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:0;Margin:0;padding-top:5px;padding-bottom:10px"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:21px;color:#333333;font-size:14px">
                                <strong>Recruiter's Note:</strong> 📝 Now, loosen that tie or kick off those high heels –
                                it's contemplation time! So make sure to take a moment to think, process, contemplate,
                                and assign a status to our newest contender. Your insights are the key to unlocking the
                                next chapter in our hiring journey.</p></td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:0;Margin:0;font-size:0px"><img class="adapt-img"
                                                                                               src="https://ecqckvr.stripocdn.email/content/guids/CABINET_9365355ef273f24312e493722d52a0da0e78cddc25b5fb96dee4c90ec2336ccd/images/undraw_just_browsing_re_ofnd.png"
                                                                                               alt=""
                                                                                               style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"
                                                                                               height="296"></td>
                            </tr>
                            <tr>
                              <td align="center" class="es-m-txt-c" style="padding:0;Margin:0;padding-bottom:15px"><h2
                                style="Margin:0;line-height:19px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:16px;font-style:normal;font-weight:bold;color:#333333">
                                For more info about ${candidate.name}, make sure</h2>
                                <h2
                                  style="Margin:0;line-height:19px;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-size:16px;font-style:normal;font-weight:bold;color:#333333">
                                  to check the full application</h2></td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:0;Margin:0"><span class="es-button-border"
                                                                                  style="border-style:solid;border-color:#2CB543;background:#5C68E2;border-width:0px;display:inline-block;border-radius:5px;width:auto"><a
                                href="https://recruit-sandbox.solute.ai/dashboard/submissions/form/${job.id}/"
                                class="es-button" target="_blank"
                                style="mso-style-priority:100 !important;text-decoration:none;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;color:#FFFFFF;font-size:20px;padding:10px 30px 10px 30px;display:inline-block;background:#5C68E2;border-radius:5px;font-family:arial, 'helvetica neue', helvetica, sans-serif;font-weight:normal;font-style:normal;line-height:24px;width:auto;text-align:center;mso-padding-alt:0;mso-border-alt:10px solid #5C68E2">Check Full Application</a></span>
                              </td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
        <table cellpadding="0" cellspacing="0" class="es-footer" align="center" role="none"
               style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%;background-color:transparent;background-repeat:repeat;background-position:center top">
          <tbody>
          <tr>
            <td align="center" style="padding:0;Margin:0">
              <table class="es-footer-body" align="center" cellpadding="0" cellspacing="0"
                     style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:transparent;width:640px"
                     role="none">
                <tbody>
                <tr>
                  <td align="left"
                      style="Margin:0;padding-top:20px;padding-bottom:20px;padding-left:20px;padding-right:20px">
                    <table cellpadding="0" cellspacing="0" width="100%" role="none"
                           style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                      <tbody>
                      <tr>
                        <td align="left" style="padding:0;Margin:0;width:600px">
                          <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
                                 style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                            <tbody>
                            <tr>
                              <td align="center"
                                  style="padding:0;Margin:0;padding-top:15px;padding-bottom:15px;font-size:0">
                                <table cellpadding="0" cellspacing="0" class="es-table-not-adapt es-social"
                                       role="presentation"
                                       style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                                  <tbody>
                                  <tr>
                                    <td align="center" valign="top" style="padding:0;Margin:0;padding-right:40px"><a
                                      target="_blank" href="https://www.facebook.com/soluteai"
                                      style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#333333;font-size:12px"><img
                                      title="Facebook"
                                      src="https://ecqckvr.stripocdn.email/content/assets/img/social-icons/logo-black/facebook-logo-black.png"
                                      alt="Fb" width="32"
                                      style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a>
                                    </td>
                                    <td align="center" valign="top" style="padding:0;Margin:0;padding-right:40px"><a
                                      target="_blank" href="https://twitter.com/solute_ai"
                                      style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#333333;font-size:12px"><img
                                      title="Twitter"
                                      src="https://ecqckvr.stripocdn.email/content/assets/img/social-icons/logo-black/twitter-logo-black.png"
                                      alt="Tw" width="32"
                                      style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a>
                                    </td>
                                    <td align="center" valign="top" style="padding:0;Margin:0;padding-right:40px"><a
                                      target="_blank" href="https://www.instagram.com/solute.ai/"
                                      style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#333333;font-size:12px"><img
                                      title="Instagram"
                                      src="https://ecqckvr.stripocdn.email/content/assets/img/social-icons/logo-black/instagram-logo-black.png"
                                      alt="Inst" width="32"
                                      style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a>
                                    </td>
                                    <td align="center" valign="top" style="padding:0;Margin:0"><a target="_blank"
                                                                                                  href="https://www.youtube.com/channel/UCSYWMbQVvr7tMq3g9ogWR0g"
                                                                                                  style="-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;text-decoration:underline;color:#333333;font-size:12px"><img
                                      title="Youtube"
                                      src="https://ecqckvr.stripocdn.email/content/assets/img/social-icons/logo-black/youtube-logo-black.png"
                                      alt="Yt" width="32"
                                      style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a>
                                    </td>
                                  </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:0;Margin:0;padding-bottom:35px"><p
                                style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:18px;color:#333333;font-size:12px">
                                Solute for recruiters. All Rights Reserved.</p>
                                <p
                                  style="Margin:0;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;mso-line-height-rule:exactly;font-family:arial, 'helvetica neue', helvetica, sans-serif;line-height:18px;color:#333333;font-size:12px">
                                  2024</p></td>
                            </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>
    </tbody>
  </table>
</div>
</body>
</html>
`
}

const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Hello from Solute!</title>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js"></script>
    <script>
      setTimeout(() => {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          disableForReducedMotion: true
        });
      }, 500);
    </script>
    <style>
      @import url("https://p.typekit.net/p.css?s=1&k=vnd5zic&ht=tk&f=39475.39476.39477.39478.39479.39480.39481.39482&a=18673890&app=typekit&e=css");
      @font-face {
        font-family: "neo-sans";
        src: url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff2"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/d?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/a?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("opentype");
        font-style: normal;
        font-weight: 700;
      }
      html {
        font-family: neo-sans;
        font-weight: 700;
        font-size: calc(62rem / 16);
      }
      body {
        background: white;
      }
      section {
        border-radius: 1em;
        padding: 1em;
        position: absolute;
        top: 50%;
        left: 50%;
        margin-right: -50%;
        transform: translate(-50%, -50%);
      }
    </style>
  </head>
  <body>
    <section>
      Hello from Solute!
    </section>
  </body>
</html>
`
