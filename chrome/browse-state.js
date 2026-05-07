// PiQPull — Browse: State
// Single job: own all mutable state and chrome.storage read/write.
// No DOM. No API calls. No export logic.

const BrowseState = (() => {
  let allConversations = [];
  let filteredConversations = [];
  let allProjects = [];
  let projectsMap = {};
  let orgId = null;
  let sortStack = [{ field: 'updated', direction: 'desc' }];
  let selectedConversations = new Set();
  let lastCheckedIndex = null;
  let exportTimestamps = {};
  let statusFilter = 'all';
  let dateFormat = 'mdy';
  let timeFormat = '12h';

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
    get statusFilter() { return statusFilter; },
    set statusFilter(v) { statusFilter = v; },
    get dateFormat() { return dateFormat; },
    set dateFormat(v) { dateFormat = v; },
    get timeFormat() { return timeFormat; },
    set timeFormat(v) { timeFormat = v; },

    // ---------------------------------------------------------------------------
    // Export timestamp helpers
    // ---------------------------------------------------------------------------

    isNewOrUpdated(conv) {
      const last = exportTimestamps[conv.uuid];
      if (!last) return true;
      return new Date(conv.updated_at) > new Date(last);
    },

    // ---------------------------------------------------------------------------
    // chrome.storage persistence
    // ---------------------------------------------------------------------------

    async loadTimestamps() {
      return new Promise(resolve => {
        chrome.storage.local.get(['exportTimestamps'], result => {
          exportTimestamps = result.exportTimestamps || {};
          resolve();
        });
      });
    },

    async saveTimestamp(conversationId) {
      exportTimestamps[conversationId] = new Date().toISOString();
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps }, resolve));
    },

    async saveTimestamps(ids) {
      const now = new Date().toISOString();
      for (const id of ids) exportTimestamps[id] = now;
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps }, resolve));
    },

    async clearAllTimestamps() {
      exportTimestamps = {};
      return new Promise(resolve => chrome.storage.local.set({ exportTimestamps: {} }, resolve));
    },

    async markAllExported(ids) {
      return this.saveTimestamps(ids);
    },

    async loadPrefs() {
      return new Promise(resolve => {
        chrome.storage.local.get(['dateFormat', 'timeFormat'], result => {
          dateFormat = result.dateFormat || 'mdy';
          timeFormat = result.timeFormat || '12h';
          resolve();
        });
      });
    },

    async saveDateFormat(val) {
      dateFormat = val;
      return new Promise(resolve => chrome.storage.local.set({ dateFormat }, resolve));
    },

    async saveTimeFormat(val) {
      timeFormat = val;
      return new Promise(resolve => chrome.storage.local.set({ timeFormat }, resolve));
    },

    async loadServerPush() {
      return new Promise(resolve => {
        chrome.storage.sync.get(['serverPush'], r => resolve(!!r.serverPush));
      });
    }
  };
})();
