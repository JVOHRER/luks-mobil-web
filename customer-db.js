const CustomerDb = (() => {
  const DB_NAME = "luks-mobil";
  const DB_VERSION = 2;
  const STORE = "customers";
  let databasePromise;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const customers = database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          customers.createIndex("name", "name", { unique: false });
          customers.createIndex("city", "city", { unique: false });
          customers.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains("activities")) {
          const activities = database.createObjectStore("activities", { keyPath: "id", autoIncrement: true });
          activities.createIndex("name", "name", { unique: false });
          activities.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }

  async function list() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result.sort((a, b) => String(a.name).localeCompare(String(b.name), "de")));
    });
  }

  async function save(customer) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).put(customer);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function remove(id) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).delete(Number(id));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async function replaceAll(customers) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      store.clear();
      customers.forEach((customer) => store.put(customer));
    });
  }

  return { open, list, save, remove, replaceAll };
})();

const ActivityDb = (() => {
  const STORE = "activities";

  async function list() {
    const database = await CustomerDb.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result.sort((a, b) => String(a.name).localeCompare(String(b.name), "de")));
    });
  }

  async function save(activity) {
    const database = await CustomerDb.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).put(activity);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function remove(id) {
    const database = await CustomerDb.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).delete(Number(id));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async function replaceAll(activities) {
    const database = await CustomerDb.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      store.clear();
      activities.forEach((activity) => store.put(activity));
    });
  }

  return { list, save, remove, replaceAll };
})();
