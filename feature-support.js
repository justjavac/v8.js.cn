function describeSupport(input) {
  switch (input) {
    case 'no': {
      return `<span class="support">不支持</span>`;
    }
    case 'yes': {
      return `<span class="support">支持</span>`;
    }
    default: {
      return `<span class="support">自 <span class="version">${input}</span> 版开始支持</span>`;
    }
  }
}

const mapFromEnvironmentIdsToNames = new Map([
  ['chrome', 'Chrome'],
  ['firefox', 'Firefox'],
  ['safari', 'Safari'],
  ['nodejs', 'Node.js'],
  ['babel', 'Babel'],
]);

function environmentIdToName(input) {
  return mapFromEnvironmentIdsToNames.get(input);
}

function expandFeatureSupport(input) {
  // https://stackoverflow.com/a/1732454/96656
  const re = /<feature-support\s+chrome="(?<chrome>[^"]+)"\s+firefox="(?<firefox>[^"]+)"\s+safari="(?<safari>[^"]+)"\s+nodejs="(?<nodejs>[^"]+)"\s+babel="(?<babel>[^"]+)"><\/feature-support>/g;
  return input.replace(re, (...args) => {
    const groups = args[args.length - 1];
    const buf = ['<ul class="feature-support">'];
    for (const [key, value] of Object.entries(groups)) {
      const [version, url] = value.split(' ');
      buf.push(`
        <li class="environment ${ version === 'no' ? 'no-support' : 'has-support' }${ url ? ' has-link' : ''}">
          ${ url ? `<a href="${ encodeURI(url) }">` : '' }
            <span class="icon ${ key }">${ environmentIdToName(key) }:</span>
            ${ describeSupport(version) }
          ${ url ? '</a>' : '' }
        </li>
      `);
    }
    buf.push('</ul><div class="feature-support-info"><a href="/features/support">关于特性支持列表</a></div>');
    return buf.join('\n').replace(/\s+/g, ' ');
  });
}

module.exports = expandFeatureSupport;
