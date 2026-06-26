// Mock Supabase Client
// Simulates an offline-first PostgreSQL database with Realtime subscriptions.

class MockSupabase {
  constructor() {
    this.listeners = {};
    this.db = {
      boats: [],
      courses: [],
      tracks: []
    };

    const defaultCourse = {
      id: 'course-bodrum-demo',
      name: 'Bodrum Bay Demo',
      checkpoints: [
        { id: 'start', type: 'start', coord: [37.020, 27.430], width: 300, rotationDeg: 60, crossing: 'center' },
        { id: 'buoy-1', type: 'buoy', coord: [37.008, 27.415], rounding: 'port' },
        { id: 'buoy-2', type: 'buoy', coord: [37.012, 27.442], rounding: 'starboard' },
        { id: 'finish', type: 'finish', coord: [37.018, 27.424], width: 300, rotationDeg: 60, crossing: 'center' }
      ]
    };

    const storedCourses = localStorage.getItem('rc_courses');
    let coursesList = [];
    if (storedCourses) {
      try {
        coursesList = JSON.parse(storedCourses);
        const demoIdx = coursesList.findIndex(c => c.id === 'course-bodrum-demo');
        if (demoIdx >= 0) {
          const demoCourse = coursesList[demoIdx];
          const startCp = demoCourse.checkpoints?.find(cp => cp.id === 'start');
          const finishCp = demoCourse.checkpoints?.find(cp => cp.id === 'finish');
          if (!startCp || startCp.width !== 300 || startCp.rotationDeg !== 60 || !finishCp || finishCp.coord[0] === 37.020 || finishCp.coord[0] === 37.024) {
            coursesList[demoIdx] = defaultCourse;
            localStorage.setItem('rc_courses', JSON.stringify(coursesList));
          }
        } else {
          coursesList.unshift(defaultCourse);
          localStorage.setItem('rc_courses', JSON.stringify(coursesList));
        }
      } catch (e) {
        coursesList = [defaultCourse];
        localStorage.setItem('rc_courses', JSON.stringify(coursesList));
      }
    } else {
      coursesList = [defaultCourse];
      localStorage.setItem('rc_courses', JSON.stringify(coursesList));
    }
    this.db.courses = coursesList;
    
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
