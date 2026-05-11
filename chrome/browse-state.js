// PiQPull — Browse: State v1.2.0
// Added: accountSlug state + loadAccountSlug / saveAccountSlug

const BrowseState = (() => {
  let allConversations = [];
  let filteredConversations = [];
  let allProjects = [];
  let projectsMap = {};
  let orgId = null;
  let orgName = null;
  let accountSlug = 'unknown';  // NEW v1.2.0
  let sortStack = [{ field: 'updated', direction: 'desc' }];
  let selectedConversations = new Set();
  let lastCheckedIndex = null;
  let exportTimestamps = {};
  let statusFilter = 'all';
  let dateFormat = 'mdy';
  let timeFormat = '12h';
  let piQuixProjectFolder = '';
  let piQuixProjectName = '';
  let groupByProject = false;
  let includeProjectHome = false;

  return {
    get all() { return allConversations; },
    set all(v) { allConversations = v; },
    get filtered() { return filteredConversations; },
    set filtered(v) { filteredConversations = v; },
    get projects() { return allProjects; },
    set projects(v) { allProjects = v; },
    get pMap() { return projectsMap; },
    set pMap(v) { projectsMap = v; },
    get orgId() { return orgId; },
    set orgId(v) { orgId = v; },
    get orgName() { return orgName; },
    set orgName(v) { orgName = v; },
    get accountSlug() { return accountSlug; },         // NEW
    set accountSlug(v) { accountSlug = v; },            // NEW
    get sortStack() { return sortStack; },
    set sortStack(v) { sortStack = v; },
    get selected() { return selectedConversations; },
    get lastIdx() { return lastCheckedIndex; },
    set lastIdx(v) { lastCheckedIndex = v; },
    get timestamps() { return exportTimestamps; },
    get statusFilter() { return statusFilter; },
    set statusFilter(v) { statusFilter = v; },
    get dateFormat() { return dateFormat; },
    set dateFormat(v) { dateFormat = v; },
    get timeFormat() { return timeFormat; },
    set timeFormat(v) { timeFormat = v; },
    get piQuixProjectFolder() { return piQuixProjectFolder; },
    set piQuixProjectFolder(v) { piQuixProjectFolder = v; },
    get piQuixProjectName() { return piQuixProjectName; },
    set piQuixProjectName(v) { piQuixProjectName = v; },
    get groupByProject() { return groupByProject; },
    set groupByProject(v) { groupByProject = !!v; },
    get includeProjectHome() { return includeProjectHome; },
    set includeProjectHome(v) { includeProjectHome = !!v; },

    isNewOrUpdated(conv) {
      const lastExportTime = exportTimestamps[conv.uuid];
      if (!lastExportTime) return true;
      return new Date(conv.updated_at) > new Date(lastExportTime);
    },

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

    async saveDateFormat(fmt) {
      dateFormat = fmt;
      return new Promise(resolve => chrome.storage.local.set({ dateFormat }, resolve));
    },

    async saveTimeFormat(fmt) {
      timeFormat = fmt;
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
          piQuixProjectName = stored.piQuixProjectName || '';
          resolve({ folder: piQuixProjectFolder, projectName: piQuixProjectName });
        });
      });
    },

    async savePiQuixProjectSelection(folder, projectName) {
      piQuixProjectFolder = folder;
      piQuixProjectName = projectName;
      return new Promise(resolve => {
        chrome.storage.sync.set({ piQuixProjectFolder: folder, piQuixProjectName: projectName }, resolve);
      });
    },

    // NEW v1.2.0: account slug persistence
    async loadAccountSlug() {
      return new Promise(resolve => {
        chrome.storage.sync.get(['currentAccountSlug'], stored => {
          accountSlug = stored.currentAccountSlug || 'unknown';
          resolve(accountSlug);
        });
      });
    },

    async saveAccountSlug(slug) {
      accountSlug = slug;
      return new Promise(resolve =>
        chrome.storage.sync.set({ currentAccountSlug: slug }, resolve));
    },

    async loadGroupPrefs() {
      return new Promise(resolve => {
        chrome.storage.local.get(['groupByProject', 'includeProjectHome'], stored => {
          groupByProject = !!stored.groupByProject;
          includeProjectHome = !!stored.includeProjectHome;
          resolve();
        });
      });
    },

    async saveGroupByProject(val) {
      groupByProject = !!val;
      return new Promise(resolve =>
        chrome.storage.local.set({ groupByProject }, resolve));
    },

    async saveIncludeProjectHome(val) {
      includeProjectHome = !!val;
      return new Promise(resolve =>
        chrome.storage.local.set({ includeProjectHome }, resolve));
    }
  };
})();
