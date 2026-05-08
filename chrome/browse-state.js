// PiQPull — Browse: State
// Single job: own all mutable state and chrome.storage read/write.
// No DOM. No API calls. No export logic.

const BrowseState = (() => {
  let allConversations       = [];
  let filteredConversations  = [];
  let allProjects            = [];
  let projectsMap            = {};
  let orgId                  = null;
  let sortStack              = [{ field: 'updated', direction: 'desc' }];
  let selectedConversations  = new Set();
  let lastCheckedIndex       = null;
  let exportTimestamps       = {};
  let statusFilter           = 'all';
  let dateFormat             = 'mdy';
  let timeFormat             = '12h';
  let piQuixProjectFolder    = '';  // PiQuix project folder for /export/incoming routing
  let piQuixProjectName      = '';  // Display name (claudeProject value)
  let orgName                = null; // Claude.ai account/org name — persisted via detectOrgId

  // ---------------------------------------------------------------------------
  // Getters / Setters
  // ---------------------------------------------------------------------------

  return {
    get all()        { return allConversations; },
    set all(v)       { allConversations = v; },
    get filtered()   { return filteredConversations; },
    set filtered(v)  { filteredConversations = v; },
    get projects()   { return allProjects; },
    set projects(v)  { allProjects = v; },
    get pMap()       { return projectsMap; },
    set pMap(v)      { projectsMap = v; },
    get orgId()      { return orgId; },
    set orgId(v)     { orgId = v; },
    get sortStack()  { return sortStack; },
    set sortStack(v) { sortStack = v; },
    get selected()   { return selectedConversations; },
    get lastIdx()    { return lastCheckedIndex; },
    set lastIdx(v)   { lastCheckedIndex = v; },
    get timestamps() { return exportTimestamps; },
    get statusFilter()    { return statusFilter; },
    set statusFilter(v)   { statusFilter = v; },
    get dateFormat()      { return dateFormat; },
    set dateFormat(v)     { dateFormat = v; },
    get timeFormat()      { return timeFormat; },
    set timeFormat(v)     { timeFormat = v; },
    get piQuixProjectFolder()   { return piQuixProjectFolder; },
    set piQuixProjectFolder(v)  { piQuixProjectFolder = v; },
    get piQuixProjectName()     { return piQuixProjectName; },
    set piQuixProjectName(v)    { piQuixProjectName = v; },
    get orgName()               { return orgName; },
    set orgName(v)              { orgName = v; },

    // ---------------------------------------------------------------------------
    // Export timestamp helpers
    // ---------------------------------------------------------------------------

    isNewOrUpdated(conv) {
      const lastExportTime = exportTimestamps[conv.uuid];
      if (!lastExportTime) return true;
      return new Date(conv.updated_at) > new Date(lastExportTime);
    },

    // ---------------------------------------------------------------------------
    // chrome.storage persistence
    // ---------------------------------------------------------------------------

    async loadTimestamps() {
      return new Promise(resolve => {
        chrome.storage.local.get(['exportTimestamps'], stored => {
          exportTimestamps = stored.exportTimestamps || {};
          resolve();
        });
      });
    },

    async saveTimestamp(conversationId) {
      exportTimestamps[conversationId] = new Date().toISOString();
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps }, resolve));
    },

    async saveTimestamps(conversationIds) {
      const nowIso = new Date().toISOString();
      for (const convId of conversationIds) exportTimestamps[convId] = nowIso;
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps }, resolve));
    },

    async clearAllTimestamps() {
      exportTimestamps = {};
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps: {} }, resolve));
    },

    async markAllExported(conversationIds) {
      return this.saveTimestamps(conversationIds);
    },

    async loadPrefs() {
      return new Promise(resolve => {
        chrome.storage.local.get(['dateFormat', 'timeFormat'], stored => {
          dateFormat = stored.dateFormat || 'mdy';
          timeFormat = stored.timeFormat || '12h';
          resolve();
        });
      });
    },

    async saveDateFormat(selectedFormat) {
      dateFormat = selectedFormat;
      return new Promise(resolve => chrome.storage.local.set({ dateFormat }, resolve));
    },

    async saveTimeFormat(selectedFormat) {
      timeFormat = selectedFormat;
      return new Promise(resolve => chrome.storage.local.set({ timeFormat }, resolve));
    },

    async loadServerPush() {
      return new Promise(resolve => {
        chrome.storage.sync.get(['serverPush'], stored => resolve(!!stored.serverPush));
      });
    },

    async loadPiQuixProjectSelection() {
      return new Promise(resolve => {
        chrome.storage.sync.get(['piQuixProjectFolder', 'piQuixProjectName'], stored => {
          piQuixProjectFolder = stored.piQuixProjectFolder || '';
          piQuixProjectName   = stored.piQuixProjectName   || '';
          resolve({ folder: piQuixProjectFolder, projectName: piQuixProjectName });
        });
      });
    },

    async savePiQuixProjectSelection(folder, projectName) {
      piQuixProjectFolder = folder;
      piQuixProjectName   = projectName;
      return new Promise(resolve => {
        chrome.storage.sync.set({ piQuixProjectFolder: folder, piQuixProjectName: projectName }, resolve);
      });
    }
  };
})();
