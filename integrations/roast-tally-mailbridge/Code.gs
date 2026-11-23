/**
 * Separate, owner-run intake. Reads matching email and creates new tally files
 * only in the fixed folder. No web endpoint, mail mutation, original-file overwrite,
 * deletion, permission change or financial calculation. Linked source exports
 * use only Google's fixed Drive API endpoint; source files remain untouched.
 */
const TALLY_MAILBOX = 'roaster@blackmarketroasters.com.au';
const TALLY_FOLDER = '1rxLbvoqyaxEdRJWJeWBOwmnmDqxnHXEo';
const TALLY_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TALLY_XLS = 'application/vnd.ms-excel';
const TALLY_SHEET = 'application/vnd.google-apps.spreadsheet';
const TALLY_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const TALLY_MAX_BYTES = 2000000; // Matches the dashboard's workbook input bound.
const TALLY_MAX_SCAN_BYTES = 8000000;
const TALLY_MAX_MESSAGES = 50;
const TALLY_MAX_ATTACHMENTS = 12;
const TALLY_HANDLER = 'runRoastTallyIntake';
const TALLY_LEDGER_PREFIX = 'TALLY_INTAKE_';
const TALLY_STATUS_KEY = 'TALLY_LAST_STATUS';
const TALLY_DEFAULT_SENDERS = ['info@blackmarketroasters.com.au'];

function tallyError_(code) {
  const error = new Error(code);
  error.safeCode = code;
  return error;
}

function tallyEmail_(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

function tallySender_(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\r\n\u0000-\u001f\u007f]/.test(value)) return null;
  const match = value.trim().match(/^(?:[^<>]*<)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?:>)?$/i);
  return match ? tallyEmail_(match[1]) : null;
}

function tallyDate_(date) {
  return Utilities.formatDate(date, 'Australia/Sydney', 'yyyy-MM-dd');
}

function tallyAddDays_(day, count) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function tallyMonday_(day) {
  const date = new Date(day + 'T12:00:00Z');
  return tallyAddDays_(day, -((date.getUTCDay() + 6) % 7));
}

function tallyParseDate_(day, monthName, year) {
  const month = TALLY_MONTHS.indexOf(monthName.toUpperCase()) + 1;
  if (!month || !/^20\d{2}$/.test(String(year))) return null;
  const date = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(Number(day)).padStart(2, '0');
  const parsed = new Date(date + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && parsed.getUTCDay() === 1 ? date : null;
}

function tallyFilename_(name) {
  if (typeof name !== 'string' || name.length > 120 || /[\u0000-\u001f\u007f/\\]/.test(name)) return null;
  const match = name.trim().match(/^ROAST\s+TALLY\s+(\d{1,2})\s+([A-Z]{3})\s+(20\d{2})\.(xlsx|xls)$/i);
  if (!match) return null;
  const weekStart = tallyParseDate_(match[1], match[2], match[3]);
  if (!weekStart) return null;
  const base = 'ROAST TALLY ' + Number(match[1]) + ' ' + match[2].toUpperCase() + ' ' + match[3];
  return { weekStart: weekStart, extension: match[4].toLowerCase(), base: base };
}

function tallyExistingWeek_(file, year) {
  if (!file || ![TALLY_XLSX, TALLY_SHEET].includes(file.mimeType) || typeof file.name !== 'string' || file.name.length > 240 ||
      !/roast/i.test(file.name) || !/tally/i.test(file.name) || /template|example|master/i.test(file.name)) return null;
  // Match legacy names accepted by the existing dashboard as well as new names.
  const match = file.name.match(/(?:^|[\s_])([0-3]?\d)(?:st|nd|rd|th)?[\s_-]+(jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)(?:[\s_-]+(20\d{2}))?/i);
  return match ? tallyParseDate_(match[1], match[2].slice(0, 3), match[3] || year) : null;
}

function tallyHash_(algorithm, bytes) {
  return Utilities.computeDigest(algorithm, bytes).map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function tallyStringHash_(value) {
  return tallyHash_(Utilities.DigestAlgorithm.SHA_256, Utilities.newBlob(value).getBytes());
}

function tallyConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const configured = properties.getProperty('APPROVED_SENDERS');
  const senders = configured === null || configured === '' ? TALLY_DEFAULT_SENDERS.slice() : configured.split(',').map(tallyEmail_);
  if (!senders.length || senders.length > 5 || senders.some(function (sender) { return !sender || sender === TALLY_MAILBOX; }) || new Set(senders).size !== senders.length) {
    throw tallyError_('APPROVED_SENDERS_INVALID');
  }
  const profile = Gmail.Users.getProfile('me');
  if (tallyEmail_(profile && profile.emailAddress) !== TALLY_MAILBOX) throw tallyError_('ROASTER_ACCOUNT_REQUIRED');
  const folder = Drive.Files.get(TALLY_FOLDER, { fields: 'id,mimeType,trashed,capabilities(canAddChildren)', supportsAllDrives: true });
  if (!folder || folder.id !== TALLY_FOLDER || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed ||
      folder.capabilities && folder.capabilities.canAddChildren === false) throw tallyError_('TALLY_FOLDER_WRITE_ACCESS_REQUIRED');
  if (!folder.capabilities || folder.capabilities.canAddChildren !== true) throw tallyError_('TALLY_FOLDER_WRITE_ACCESS_REQUIRED');
  return { senders: senders, properties: properties };
}

function tallyFiles_() {
  const files = [];
  let token;
  do {
    const page = Drive.Files.list({
      q: "'" + TALLY_FOLDER + "' in parents and trashed = false",
      pageSize: 100, pageToken: token,
      fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,appProperties,parents,trashed)',
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    if (!page || !Array.isArray(page.files)) throw tallyError_('FOLDER_READING_INVALID');
    files.push.apply(files, page.files);
    if (files.length > 500) throw tallyError_('FOLDER_REVIEW_REQUIRED');
    token = page.nextPageToken;
  } while (token);
  return files;
}

function tallyPartFields_(depth) {
  const fields = 'filename,mimeType,body(attachmentId,size,data)';
  return depth > 0 ? fields + ',parts(' + tallyPartFields_(depth - 1) + ')' : fields;
}

function tallySubjectWeek_(subject) {
  if (typeof subject !== 'string' || subject.length > 160 || /[\r\n\u0000-\u001f\u007f]/.test(subject)) return null;
  const match = subject.trim().match(/^Roast\s+Schedule\s*[-–—:]\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})$/i);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return tallyParseDate_(match[1], TALLY_MONTHS[Number(match[2]) - 1], match[3]);
}

function tallyBodyLinks_(payload) {
  const links = new Set();
  let bytesRead = 0, partsRead = 0;
  const walk = function (part, depth) {
    if (!part || depth > 6 || ++partsRead > 120) throw tallyError_('MESSAGE_STRUCTURE_REVIEW_REQUIRED');
    if (!part.filename && ['text/plain', 'text/html'].includes(part.mimeType) && part.body && typeof part.body.data === 'string') {
      if (part.body.data.length > 140000) throw tallyError_('MESSAGE_TEXT_TOO_LARGE');
      const bytes = Utilities.base64DecodeWebSafe(part.body.data);
      bytesRead += bytes.length;
      if (bytesRead > 100000) throw tallyError_('MESSAGE_TEXT_TOO_LARGE');
      const text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
      // Only an exact Google Sheets host/path can yield a source ID. No URL is followed.
      const pattern = /https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?=[/\s?#"'<>]|$)/g;
      let match;
      while ((match = pattern.exec(text)) !== null) links.add(match[1]);
      if (links.size > 10) throw tallyError_('TOO_MANY_SOURCE_LINKS');
    }
    (part.parts || []).forEach(function (child) { walk(child, depth + 1); });
  };
  walk(payload, 0);
  return Array.from(links);
}

function tallySourceBytes_(source) {
  const path = source.mimeType === TALLY_SHEET
    ? '/export?mimeType=' + encodeURIComponent(TALLY_XLSX)
    : '?alt=media';
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + source.id + path, {
    method: 'get', followRedirects: false, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Accept: TALLY_XLSX },
  });
  // Google Drive API serves these directly. Never forward OAuth to a redirect.
  if (response.getResponseCode() !== 200) throw tallyError_('SOURCE_EXPORT_FAILED');
  const headers = response.getAllHeaders();
  const contentType = String(headers['Content-Type'] || headers['content-type'] || '').split(';')[0].toLowerCase();
  if (![TALLY_XLSX, 'application/octet-stream', 'application/zip'].includes(contentType)) throw tallyError_('SOURCE_EXPORT_TYPE_INVALID');
  const length = Number(headers['Content-Length'] || headers['content-length'] || 0);
  if (length > TALLY_MAX_BYTES) throw tallyError_('SOURCE_EXPORT_TOO_LARGE');
  const bytes = response.getContent();
  if (bytes.length < 8 || bytes.length > TALLY_MAX_BYTES ||
      ![80, 75, 3, 4].every(function (byte, index) { return (bytes[index] + 256) % 256 === byte; })) throw tallyError_('SOURCE_EXPORT_INVALID');
  return bytes;
}

function tallyLinkedCandidate_(id, subjectWeek) {
  const source = Drive.Files.get(id, { fields: 'id,name,mimeType,parents,trashed,modifiedTime', supportsAllDrives: true });
  if (!source || source.id !== id || source.trashed || ![TALLY_SHEET, TALLY_XLSX].includes(source.mimeType)) return null;
  const name = source.name + (source.mimeType === TALLY_SHEET && !/\.xlsx$/i.test(source.name) ? '.xlsx' : '');
  const parsed = tallyFilename_(name);
  if (!parsed || parsed.weekStart !== subjectWeek) return null;
  const candidate = {
    weekStart: subjectWeek, extension: 'xlsx', base: parsed.base, name: parsed.base + '.xlsx',
    sourceId: id, sourceModifiedTime: typeof source.modifiedTime === 'string' ? source.modifiedTime : null,
    ledgerKey: TALLY_LEDGER_PREFIX + tallyStringHash_('linked:' + id + ':' + subjectWeek),
  };
  if (Array.isArray(source.parents) && source.parents.includes(TALLY_FOLDER)) {
    candidate.skipStatus = 'source-already-in-folder';
    return candidate;
  }
  const bytes = tallySourceBytes_(source);
  candidate.bytes = bytes;
  candidate.hash = tallyHash_(Utilities.DigestAlgorithm.SHA_256, bytes);
  candidate.md5 = tallyHash_(Utilities.DigestAlgorithm.MD5, bytes);
  candidate.intakeKey = tallyStringHash_('linked:' + id + ':' + subjectWeek);
  return candidate;
}

function tallyHeader_(payload, name) {
  const headers = (payload && payload.headers || []).filter(function (header) {
    return typeof header.name === 'string' && header.name.toLowerCase() === name;
  });
  return headers.length === 1 && typeof headers[0].value === 'string' ? headers[0].value : null;
}

function tallyAttachmentParts_(payload) {
  const found = [];
  let count = 0;
  const walk = function (part, depth) {
    if (!part || depth > 6 || ++count > 120) throw tallyError_('MESSAGE_STRUCTURE_REVIEW_REQUIRED');
    const filename = tallyFilename_(part.filename);
    if (filename) found.push({ part: part, filename: filename });
    (part.parts || []).forEach(function (child) { walk(child, depth + 1); });
  };
  walk(payload, 0);
  return found;
}

function tallyCandidate_(message, item) {
  const part = item.part, body = part.body || {}, filename = item.filename;
  if (typeof body.attachmentId !== 'string' || !body.attachmentId || !Number.isSafeInteger(body.size) || body.size < 8 || body.size > TALLY_MAX_BYTES) {
    throw tallyError_('ATTACHMENT_SIZE_OR_REFERENCE_INVALID');
  }
  const permittedMimes = filename.extension === 'xlsx' ? [TALLY_XLSX, 'application/octet-stream'] : [TALLY_XLS, 'application/octet-stream'];
  if (!permittedMimes.includes(part.mimeType)) throw tallyError_('ATTACHMENT_TYPE_INVALID');
  const attachment = Gmail.Users.Messages.Attachments.get('me', message.id, body.attachmentId);
  if (!attachment || typeof attachment.data !== 'string' || attachment.data.length > Math.ceil(TALLY_MAX_BYTES * 4 / 3) + 4) throw tallyError_('ATTACHMENT_READING_INVALID');
  const bytes = Utilities.base64DecodeWebSafe(attachment.data);
  if (bytes.length !== body.size || bytes.length > TALLY_MAX_BYTES) throw tallyError_('ATTACHMENT_SIZE_MISMATCH');
  const unsigned = bytes.slice(0, 8).map(function (byte) { return (byte + 256) % 256; });
  const signature = filename.extension === 'xlsx' ? [80, 75, 3, 4] : [208, 207, 17, 224, 161, 177, 26, 225];
  if (!signature.every(function (byte, index) { return unsigned[index] === byte; })) throw tallyError_('ATTACHMENT_SIGNATURE_INVALID');
  const hash = tallyHash_(Utilities.DigestAlgorithm.SHA_256, bytes);
  return {
    weekStart: filename.weekStart, extension: filename.extension, base: filename.base,
    name: filename.base + (filename.extension === 'xlsx' ? '.xlsx' : ''),
    hash: hash, md5: tallyHash_(Utilities.DigestAlgorithm.MD5, bytes), bytes: bytes,
    ledgerKey: TALLY_LEDGER_PREFIX + tallyStringHash_(message.id + ':' + body.attachmentId + ':' + hash),
    intakeKey: tallyStringHash_(filename.weekStart + ':' + hash),
  };
}

function tallyPlan_(config, now) {
  const today = tallyDate_(now), current = tallyMonday_(today), previous = tallyAddDays_(current, -7);
  const queryDate = tallyAddDays_(previous, -1).replace(/-/g, '/');
  const from = config.senders.length === 1 ? 'from:' + config.senders[0]
    : '{' + config.senders.map(function (sender) { return 'from:' + sender; }).join(' ') + '}';
  const query = from + ' subject:"Roast Schedule" after:' + queryDate;
  const candidates = [], issues = [];
  let token, scanned = 0, totalBytes = 0;
  do {
    const page = Gmail.Users.Messages.list('me', { q: query, maxResults: Math.min(25, TALLY_MAX_MESSAGES - scanned),
      pageToken: token, includeSpamTrash: false });
    if (!page || page.messages !== undefined && !Array.isArray(page.messages)) throw tallyError_('MAIL_READING_INVALID');
    for (const item of page.messages || []) {
      if (++scanned > TALLY_MAX_MESSAGES) throw tallyError_('MAIL_SCAN_REVIEW_REQUIRED');
      const message = Gmail.Users.Messages.get('me', item.id, {
        format: 'full', fields: 'id,internalDate,payload(headers(name,value),' + tallyPartFields_(6) + ')',
      });
      const received = Number(message.internalDate), payload = message.payload;
      if (!Number.isFinite(received) || received > now.getTime() + 120000 || tallyDate_(new Date(received)) < previous) continue;
      const actualSender = tallySender_(tallyHeader_(payload, 'from'));
      if (!config.senders.includes(actualSender)) continue;
      const subject = tallyHeader_(payload, 'subject');
      if (typeof subject !== 'string' || subject.length > 160 || /[\r\n\u0000-\u001f\u007f]/.test(subject) ||
          !/^Roast\s+Schedule(?:\s*[-–—:]\s*\d{1,2}\/\d{1,2}\/20\d{2})?$/i.test(subject.trim())) continue;
      const subjectWeek = tallySubjectWeek_(subject);
      if (subjectWeek && subjectWeek !== current && subjectWeek !== previous) continue;
      const sender = tallyHeader_(payload, 'sender');
      if (sender !== null && tallySender_(sender) !== actualSender) continue;
      const links = tallyBodyLinks_(payload);
      for (const id of links) {
        if (!subjectWeek) {
          issues.push({ weekStart: current, filename: 'Roast Schedule', status: 'needs-review', safeCode: 'LINK_SUBJECT_WEEK_REQUIRED' });
          break;
        }
        if (candidates.length + issues.length >= TALLY_MAX_ATTACHMENTS) throw tallyError_('ATTACHMENT_SCAN_REVIEW_REQUIRED');
        try {
          const candidate = tallyLinkedCandidate_(id, subjectWeek);
          if (!candidate) continue;
          totalBytes += candidate.bytes ? candidate.bytes.length : 0;
          if (totalBytes > TALLY_MAX_SCAN_BYTES) throw tallyError_('ATTACHMENT_SCAN_REVIEW_REQUIRED');
          candidates.push(candidate);
        } catch (error) {
          if (error.safeCode === 'ATTACHMENT_SCAN_REVIEW_REQUIRED') throw error;
          issues.push({ weekStart: subjectWeek, filename: 'ROAST TALLY', status: 'needs-review', safeCode: error.safeCode || 'LINKED_SOURCE_READING_FAILED' });
        }
      }
      for (const part of tallyAttachmentParts_(payload)) {
        const week = part.filename.weekStart;
        if (week !== current && week !== previous || subjectWeek && week !== subjectWeek) continue;
        if (candidates.length + issues.length >= TALLY_MAX_ATTACHMENTS) throw tallyError_('ATTACHMENT_SCAN_REVIEW_REQUIRED');
        try {
          const candidate = tallyCandidate_(message, part);
          totalBytes += candidate.bytes.length;
          if (totalBytes > TALLY_MAX_SCAN_BYTES) throw tallyError_('ATTACHMENT_SCAN_REVIEW_REQUIRED');
          candidates.push(candidate);
        } catch (error) {
          if (error.safeCode === 'ATTACHMENT_SCAN_REVIEW_REQUIRED') throw error;
          issues.push({ weekStart: week, filename: part.filename.base, status: 'needs-review', safeCode: error.safeCode || 'ATTACHMENT_READING_FAILED' });
        }
      }
    }
    token = page.nextPageToken;
    if (token && scanned >= TALLY_MAX_MESSAGES) throw tallyError_('MAIL_SCAN_REVIEW_REQUIRED');
  } while (token);
  return { current: current, previous: previous, candidates: candidates, issues: issues, messagesChecked: scanned };
}

function tallyExisting_(files, candidate) {
  return files.filter(function (file) {
    return tallyExistingWeek_(file, candidate.weekStart.slice(0, 4)) === candidate.weekStart;
  });
}

function tallySame_(file, candidate) {
  return file.appProperties && file.appProperties.tallyHash === candidate.hash ||
    candidate.extension === 'xlsx' && file.mimeType === TALLY_XLSX && file.md5Checksum === candidate.md5;
}

function tallyOwnedCopy_(file, candidate) {
  return Boolean(candidate.sourceId && file && file.mimeType === TALLY_XLSX && !file.trashed &&
    Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === TALLY_FOLDER &&
    file.appProperties && file.appProperties.tallyBridge === '1' && file.appProperties.tallySourceId === candidate.sourceId &&
    file.appProperties.tallyWeek === candidate.weekStart);
}

function tallyUploadMetadata_(candidate) {
  const properties = { tallyBridge: '1', tallyHash: candidate.hash, tallyIntakeKey: candidate.intakeKey, tallyWeek: candidate.weekStart };
  if (candidate.sourceId) {
    properties.tallySourceId = candidate.sourceId;
    if (candidate.sourceModifiedTime) properties.tallySourceModifiedTime = candidate.sourceModifiedTime;
  }
  return { name: candidate.name, mimeType: candidate.extension === 'xlsx' ? TALLY_XLSX : TALLY_SHEET,
    parents: [TALLY_FOLDER], appProperties: properties };
}

function tallyUploadConfirmed_(file, candidate, expectedMime) {
  return file && typeof file.id === 'string' && file.name === candidate.name && file.mimeType === expectedMime &&
    Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === TALLY_FOLDER;
}

function tallyResult_(now, plan, items, files) {
  const review = items.some(function (item) { return item.status === 'needs-review'; });
  const imported = items.filter(function (item) { return item.status === 'imported' || item.status === 'updated-copy'; }).length;
  const currentPresent = files.some(function (file) { return tallyExistingWeek_(file, plan.current.slice(0, 4)) === plan.current; });
  return { ok: true, status: review ? 'needs-review' : !currentPresent ? 'awaiting-tally' : imported ? 'updated' : 'checked',
    checkedAt: now.toISOString(), weekStart: plan.current, messagesChecked: plan.messagesChecked,
    currentWeekSourcePresent: currentPresent, imported: imported, items: items.slice(0, TALLY_MAX_ATTACHMENTS) };
}

function tallyRun_(write) {
  const now = new Date();
  let lock;
  try {
    if (write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(1000)) return { ok: true, status: 'busy', checkedAt: now.toISOString(), imported: 0, items: [] };
    }
    const config = tallyConfig_(), plan = tallyPlan_(config, now), items = plan.issues.slice();
    let files = tallyFiles_();
    const groups = {};
    plan.candidates.forEach(function (candidate) { (groups[candidate.weekStart] || (groups[candidate.weekStart] = [])).push(candidate); });
    for (const week of Object.keys(groups).sort()) {
      const group = groups[week];
      const identities = new Set(group.map(function (candidate) { return candidate.sourceId ? 'link:' + candidate.sourceId : 'attachment:' + candidate.hash; }));
      const linkedSources = new Set(group.filter(function (candidate) { return Boolean(candidate.sourceId); }).map(function (candidate) { return candidate.sourceId; }));
      const hashes = new Set(group.filter(function (candidate) { return candidate.hash; }).map(function (candidate) { return candidate.hash; }));
      const sameBytes = hashes.size === 1 && group.every(function (candidate) { return Boolean(candidate.hash); });
      if (linkedSources.size > 1 || identities.size > 1 && !sameBytes || plan.issues.some(function (item) { return item.weekStart === week; })) {
        items.push({ weekStart: week, filename: group[0].name, status: 'needs-review', safeCode: 'CONFLICTING_WEEK_ATTACHMENTS' });
        continue;
      }
      const candidate = group.find(function (item) { return Boolean(item.sourceId); }) || group[0];
      const existing = tallyExisting_(files, candidate);
      if (existing.length) {
        if (existing.length === 1 && candidate.sourceId === existing[0].id) {
          items.push({ weekStart: week, filename: existing[0].name, status: 'source-already-in-folder' });
          continue;
        }
        if (existing.length === 1 && tallyOwnedCopy_(existing[0], candidate)) {
          if (tallySame_(existing[0], candidate)) {
            items.push({ weekStart: week, filename: candidate.name, status: 'already-current' });
            continue;
          }
          if (!write) {
            items.push({ weekStart: week, filename: candidate.name, status: 'ready-to-update-copy' });
            continue;
          }
          try {
            const target = Drive.Files.get(existing[0].id, { fields: 'id,name,mimeType,parents,trashed,appProperties', supportsAllDrives: true });
            if (!tallyOwnedCopy_(target, candidate)) throw tallyError_('OWNED_COPY_REVIEW_REQUIRED');
            const metadata = tallyUploadMetadata_(candidate);
            const blob = Utilities.newBlob(candidate.bytes, TALLY_XLSX, candidate.name);
            // Update only this app's owned fixed-folder copy, never the source ID.
            const updated = Drive.Files.update({ name: metadata.name, appProperties: metadata.appProperties }, target.id, blob,
              { fields: 'id,name,mimeType,parents,appProperties', supportsAllDrives: true });
            if (!tallyUploadConfirmed_(updated, candidate, TALLY_XLSX) || updated.id !== target.id) throw tallyError_('UPLOAD_CONFIRMATION_REQUIRED');
            config.properties.setProperty(candidate.ledgerKey, JSON.stringify({ weekStart: week, hash: candidate.hash, state: 'imported', at: now.toISOString() }));
            items.push({ weekStart: week, filename: candidate.name, status: 'updated-copy' });
          } catch (error) {
            items.push({ weekStart: week, filename: candidate.name, status: 'needs-review', safeCode: error.safeCode || 'COPY_UPDATE_UNCONFIRMED' });
          }
          continue;
        }
        const same = existing.length === 1 && tallySame_(existing[0], candidate);
        items.push({ weekStart: week, filename: candidate.name, status: same ? 'already-imported' : 'needs-review',
          safeCode: same ? 'MATCHING_FILE_EXISTS' : 'EXISTING_WEEK_SOURCE_PRESERVED' });
        continue;
      }
      if (candidate.skipStatus) {
        items.push({ weekStart: week, filename: candidate.name, status: candidate.skipStatus });
        continue;
      }
      const prior = config.properties.getProperty(candidate.ledgerKey);
      if (prior) {
        // An uncertain create is not retried automatically. Drive listings may lag.
        items.push({ weekStart: week, filename: candidate.name, status: 'needs-review', safeCode: 'UPLOAD_CONFIRMATION_REQUIRED' });
        continue;
      }
      if (!write) {
        items.push({ weekStart: week, filename: candidate.name, status: 'ready-to-import' });
        continue;
      }
      // Recheck immediately before create. No existing source is ever overwritten.
      files = tallyFiles_();
      if (tallyExisting_(files, candidate).length) {
        items.push({ weekStart: week, filename: candidate.name, status: 'needs-review', safeCode: 'SOURCE_APPEARED_DURING_CHECK' });
        continue;
      }
      config.properties.setProperty(candidate.ledgerKey, JSON.stringify({ weekStart: week, hash: candidate.hash, state: 'pending', at: now.toISOString() }));
      try {
        const metadata = tallyUploadMetadata_(candidate);
        const blob = Utilities.newBlob(candidate.bytes, candidate.extension === 'xlsx' ? TALLY_XLSX : TALLY_XLS, candidate.name);
        const created = Drive.Files.create(metadata, blob, { fields: 'id,name,mimeType,parents,appProperties', supportsAllDrives: true });
        if (!tallyUploadConfirmed_(created, candidate, metadata.mimeType)) throw tallyError_('UPLOAD_CONFIRMATION_REQUIRED');
        config.properties.setProperty(candidate.ledgerKey, JSON.stringify({ weekStart: week, hash: candidate.hash, state: 'imported', at: now.toISOString() }));
        files.push(created);
        items.push({ weekStart: week, filename: candidate.name, status: 'imported' });
      } catch (_) {
        items.push({ weekStart: week, filename: candidate.name, status: 'needs-review', safeCode: 'UPLOAD_CONFIRMATION_REQUIRED' });
      }
    }
    const result = tallyResult_(now, plan, items, files);
    if (write) config.properties.setProperty(TALLY_STATUS_KEY, JSON.stringify(result));
    return result;
  } catch (error) {
    return { ok: false, status: 'failed', checkedAt: now.toISOString(), imported: 0, items: [], safeCode: error.safeCode || 'INTAKE_READ_FAILED' };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** Read-only preview; no email, file, property or trigger is changed. */
function previewRoastTallyIntake() { return tallyRun_(false); }

/** Five-minute trigger handler. Does not alter or send any email. */
function runRoastTallyIntake() { return tallyRun_(true); }

/** Run only after reviewing the account, exact sender, preview and Google consent. */
function installRoastTallyIntake() {
  const preview = previewRoastTallyIntake();
  if (!preview.ok) return preview;
  const own = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === TALLY_HANDLER; });
  if (!own.length) ScriptApp.newTrigger(TALLY_HANDLER).timeBased().everyMinutes(5).create();
  // Remove only accidental duplicates of this exact handler, never other triggers.
  own.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  return { ok: true, status: own.length ? 'already-installed' : 'installed', handler: TALLY_HANDLER, cadenceMinutes: 5,
    previewStatus: preview.status };
}
