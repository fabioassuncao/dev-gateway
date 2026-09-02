import { describe, expect, it } from 'vitest'
import { localTlsDynamic, parseSubjectAltNames, tlsPaths } from './tls.ts'

describe('parseSubjectAltNames', () => {
  // `-ext subjectAltName` is missing from LibreSSL, which is what macOS ships
  // as `openssl`. Parsing `-text` is what works on both, and this is the shape
  // that output takes.
  it('reads the names out of an openssl -text block', () => {
    const text = [
      '        X509v3 extensions:',
      '            X509v3 Subject Alternative Name: ',
      '                DNS:*.dev.example.com, DNS:dev.example.com',
      '            X509v3 Extended Key Usage: ',
    ].join('\n')
    expect(parseSubjectAltNames(text)).toEqual(['*.dev.example.com', 'dev.example.com'])
  })

  it('answers nothing rather than throwing when the extension is absent', () => {
    expect(parseSubjectAltNames('Certificate:\n  Data:\n')).toEqual([])
    expect(parseSubjectAltNames('')).toEqual([])
  })
})

describe('tlsPaths', () => {
  it('keeps every generated file under the one git-ignored directory', () => {
    const paths = tlsPaths('/opt/portta')
    expect(paths.directory).toBe('/opt/portta/config/tls')
    for (const file of [paths.caKey, paths.caCertificate, paths.leafKey, paths.leafCertificate]) {
      expect(file.startsWith('/opt/portta/config/tls/')).toBe(true)
    }
    // The one exception: Traefik reads it from the dynamic directory.
    expect(paths.dynamic).toBe('/opt/portta/config/traefik/dynamic/local-tls.yaml')
  })
})

describe('localTlsDynamic', () => {
  it('points Traefik at the container paths, not the host ones', () => {
    const yaml = localTlsDynamic()
    expect(yaml).toContain('certFile: /etc/traefik/tls/wildcard.crt')
    expect(yaml).toContain('keyFile: /etc/traefik/tls/wildcard.key')
    // The comment names the host directory; nothing Traefik parses does.
    const directives = yaml.split('\n').filter((line) => !line.startsWith('#')).join('\n')
    expect(directives).not.toContain('config/tls')
  })

  it('says it is generated, so nobody edits it expecting the edit to survive', () => {
    expect(localTlsDynamic()).toContain('portta tls init')
  })
})
