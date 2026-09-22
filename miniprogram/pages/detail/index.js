Page({
  data: {
    id: ''
  },

  onLoad(query) {
    this.setData({ id: (query && query.id) || '' });
  }
});
