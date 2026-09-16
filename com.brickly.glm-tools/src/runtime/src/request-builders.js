/* eslint-disable */
'use strict'

const {
  assignIfPresent,
  booleanOrDefault,
  enumOrDefault,
  numberOrDefault,
  optionalString,
  parseJsonInput,
  requiredString
} = require('./input')
const { makeError } = require('./errors')

const SEARCH_ENGINES = ['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark']
const RECENCY_FILTERS = ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit']
const CONTENT_SIZES = ['medium', 'high']
const PARSER_TOOL_TYPES = ['lite', 'expert', 'prime']
const PARSER_SYNC_TOOL_TYPES = ['prime-sync']
const PARSER_FORMAT_TYPES = ['text', 'download_link']
const PARSER_ASYNC_FILE_TYPES = [
  'PDF',
  'DOCX',
  'DOC',
  'XLS',
  'XLSX',
  'PPT',
  'PPTX',
  'PNG',
  'JPG',
  'JPEG',
  'CSV',
  'TXT',
  'MD',
  'HTML',
  'BMP',
  'GIF',
  'WEBP',
  'HEIC',
  'EPS',
  'ICNS',
  'IM',
  'PCX',
  'PPM',
  'TIFF',
  'XBM',
  'HEIF',
  'JP2'
]
const PARSER_SYNC_FILE_TYPES = ['WPS', ...PARSER_ASYNC_FILE_TYPES]
const OCR_TOOL_TYPES = ['hand_write']
const OCR_LANGUAGE_TYPES = [
  'CHN_ENG',
  'AUTO',
  'ENG',
  'JAP',
  'KOR',
  'FRE',
  'SPA',
  'POR',
  'GER',
  'ITA',
  'RUS',
  'DAN',
  'DUT',
  'MAL',
  'SWE',
  'IND',
  'POL',
  'ROM',
  'TUR',
  'GRE',
  'HUN',
  'THA',
  'VIE',
  'ARA',
  'HIN'
]

function buildWebSearchRequest(input = {}, config = {}) {
  const searchQuery = requiredString(input.searchQuery, 'searchQuery')
  if (searchQuery.length > 70) {
    throw makeError('INVALID_INPUT', 'searchQuery 建议不超过 70 个字符，当前已超过接口限制')
  }

  const body = {
    search_query: searchQuery,
    search_engine: enumOrDefault(
      input.searchEngine,
      optionalString(config.defaultSearchEngine) || 'search_std',
      SEARCH_ENGINES,
      'searchEngine'
    ),
    search_intent: booleanOrDefault(input.searchIntent, false),
    count: numberOrDefault(input.count, 10, 'count', { min: 1, max: 50 }),
    search_recency_filter: enumOrDefault(
      input.searchRecencyFilter,
      'noLimit',
      RECENCY_FILTERS,
      'searchRecencyFilter'
    ),
    content_size: enumOrDefault(input.contentSize, 'medium', CONTENT_SIZES, 'contentSize')
  }

  assignIfPresent(body, 'search_domain_filter', optionalString(input.searchDomainFilter))

  const requestId = optionalString(input.requestId)
  if (requestId && (requestId.length < 6 || requestId.length > 64)) {
    throw makeError('INVALID_INPUT', 'requestId 长度必须在 6-64 个字符之间')
  }
  assignIfPresent(body, 'request_id', requestId)

  const userId = optionalString(input.userId)
  if (userId && (userId.length < 6 || userId.length > 128)) {
    throw makeError('INVALID_INPUT', 'userId 长度必须在 6-128 个字符之间')
  }
  assignIfPresent(body, 'user_id', userId)
  return body
}

function buildReaderRequest(input = {}) {
  return {
    url: requiredString(input.url, 'url'),
    timeout: numberOrDefault(input.timeout, 20, 'timeout', { min: 1, max: 120 }),
    no_cache: booleanOrDefault(input.noCache, false),
    return_format: enumOrDefault(input.returnFormat, 'markdown', ['markdown', 'text'], 'returnFormat'),
    retain_images: booleanOrDefault(input.retainImages, true),
    no_gfm: booleanOrDefault(input.noGfm, false),
    keep_img_data_url: booleanOrDefault(input.keepImgDataUrl, false),
    with_images_summary: booleanOrDefault(input.withImagesSummary, false),
    with_links_summary: booleanOrDefault(input.withLinksSummary, false)
  }
}

function buildModerationRequest(input = {}) {
  const inputType = enumOrDefault(
    input.inputType,
    'text',
    ['text', 'image_url', 'video_url', 'audio_url', 'raw_json'],
    'inputType'
  )
  let moderationInput

  if (inputType === 'raw_json') {
    moderationInput = parseJsonInput(input.inputJson, 'inputJson')
    if (moderationInput === undefined) {
      throw makeError('INVALID_INPUT', 'inputType=raw_json 时 inputJson 必填')
    }
  } else if (inputType === 'text') {
    const text = requiredString(input.text, 'text')
    if (text.length > 2000) {
      throw makeError('INVALID_INPUT', '内容安全文本输入最大 2000 字符')
    }
    moderationInput = text
  } else {
    const url = requiredString(input.url, 'url')
    moderationInput = {
      type: inputType,
      [inputType]: { url }
    }
  }

  return {
    model: enumOrDefault(input.model, 'moderation', ['moderation'], 'model'),
    input: moderationInput
  }
}

function buildParserFields(input = {}, mode) {
  const isSync = mode === 'sync'
  const fields = {
    tool_type: enumOrDefault(
      input.toolType,
      isSync ? 'prime-sync' : 'prime',
      isSync ? PARSER_SYNC_TOOL_TYPES : PARSER_TOOL_TYPES,
      'toolType'
    )
  }
  const fileType = optionalString(input.fileType)
  if (fileType) {
    fields.file_type = enumOrDefault(
      fileType,
      fileType,
      isSync ? PARSER_SYNC_FILE_TYPES : PARSER_ASYNC_FILE_TYPES,
      'fileType'
    )
  }
  return fields
}

function buildParserResultPath(input = {}) {
  const taskId = requiredString(input.taskId, 'taskId')
  const formatType = enumOrDefault(input.formatType, 'text', PARSER_FORMAT_TYPES, 'formatType')
  return `/paas/v4/files/parser/result/${encodeURIComponent(taskId)}/${encodeURIComponent(formatType)}`
}

function buildOcrFields(input = {}) {
  return {
    tool_type: enumOrDefault(input.toolType, 'hand_write', OCR_TOOL_TYPES, 'toolType'),
    language_type: enumOrDefault(input.languageType, 'AUTO', OCR_LANGUAGE_TYPES, 'languageType'),
    probability: String(booleanOrDefault(input.probability, false))
  }
}

module.exports = {
  buildWebSearchRequest,
  buildReaderRequest,
  buildModerationRequest,
  buildParserFields,
  buildParserResultPath,
  buildOcrFields,
  SEARCH_ENGINES,
  RECENCY_FILTERS,
  CONTENT_SIZES
}
