// Chat content may only load images from the providers this app supports.
// Custom CSS is user-authored and remains a separate, trusted input.
export function safeMediaURL(value) {
  if(typeof value!=='string'||value.length>8192)return false;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return false;
    return ['static-cdn.jtvnw.net','cdn.7tv.app','cdn.7tv.io','cdn.betterttv.net','cdn.frankerfacez.com','fonts.gstatic.com','yt3.ggpht.com','yt4.ggpht.com','yt3.googleusercontent.com'].includes(u.hostname)
      || /^(media\d*|i)\.giphy\.com$/.test(u.hostname);
  } catch { return false; }
}
