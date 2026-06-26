// Mock Supabase Client
// Simulates an offline-first PostgreSQL database with Realtime subscriptions.

class MockSupabase {
  constructor() {
    this.db = {
      boats: [],
      courses: [],
      tracks: []
    };
    this.listeners = {};
    
    // Actively purge all previously saved courses and active course from localStorage
    localStorage.removeItem('rc_courses');
    localStorage.removeItem('rc_active_course_id');
    localStorage.removeItem('simulated_boat_pos');
    this.db.courses = [];
    
    this.db.boats.push({
      id: 'boat-1',
      name: 'Warp Drive',
      status: 'racing'
    });
  }

  _saveToLocalStorage() {
    localStorage.setItem('rc_courses', JSON.stringify(this.db.courses));
  }

  // Simulate Supabase channel subscriptions
  channel(name) {
    const channelObj = {
      on: (event, filter, callback) => {
        if (!this.listeners[name]) this.listeners[name] = [];
        this.listeners[name].push(callback);
        return channelObj;
      },
      subscribe: () => {
        console.log(`Subscribed to channel: ${name}`);
      }
    };
    return channelObj;
  }

  _notifyListeners(channel, payload) {
    if (this.listeners[channel]) {
      this.listeners[channel].forEach(cb => cb(payload));
    }
  }

  // Simulate Supabase select
  async getCourses() {
    return [...this.db.courses];
  }

  async saveCourse(course) {
    const idx = this.db.courses.findIndex(c => c.id === course.id);
    if (idx >= 0) {
      this.db.courses[idx] = course;
    } else {
      this.db.courses.push(course);
    }
    this._saveToLocalStorage();
    return { success: true, course };
  }

  async deleteCourse(id) {
    this.db.courses = this.db.courses.filter(c => c.id !== id);
    this._saveToLocalStorage();
    return { success: true };
  }

  async getBoats() {
    return [...this.db.boats];
  }

  async getTracks() {
    return [...this.db.tracks];
  }

  // Simulate Supabase insert (batch track points)
  async insertTrackPoints(points) {
    this.db.tracks.push(...points);
    // Notify realtime listeners
    this._notifyListeners('public:tracks', { new: points });
    return { success: true };
  }
}

export const supabase = new MockSupabase();
