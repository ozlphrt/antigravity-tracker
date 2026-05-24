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
    
    // Default initial data
    const defaultCourse = {
      id: 'course-1',
      name: 'Bodrum Bay Offshore',
      checkpoints: [
        { id: 'start', type: 'start', coord: [37.0255, 27.4325], width: 100, rotationDeg: 270, crossing: 'center' },
        { id: 'buoy-1', type: 'buoy', coord: [37.010, 27.400], rounding: 'port' },
        { id: 'buoy-2', type: 'buoy', coord: [36.995, 27.450], rounding: 'starboard' },
        { id: 'finish', type: 'finish', coord: [37.0255, 27.4325], width: 100, rotationDeg: 270, crossing: 'center' }
      ]
    };

    const storedCourses = localStorage.getItem('rc_courses');
    if (storedCourses) {
      try {
        const parsed = JSON.parse(storedCourses);
        // Force upgrade course-1 if it was saved with empty checkpoints
        const c1Index = parsed.findIndex(c => c.id === 'course-1');
        if (c1Index >= 0 && parsed[c1Index].checkpoints.length === 0) {
          parsed[c1Index] = defaultCourse;
          localStorage.setItem('rc_courses', JSON.stringify(parsed));
        }
        this.db.courses = parsed;
      } catch (e) {
        this.db.courses = [defaultCourse];
      }
    } else {
      this.db.courses = [defaultCourse];
      this._saveToLocalStorage();
    }
    
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
